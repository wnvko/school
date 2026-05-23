import { HttpClient } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { Observable, forkJoin, of } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import {
  School, SchoolsResponse,
  Child, ChildrenResponse,
  AdmissionResult,
  ChildWish,
} from './models';

@Injectable({
  providedIn: 'root',
})
export class Data {
  private http = inject(HttpClient);

  // Cached data
  private cachedSchoolMap: Map<number, School> | null = null;
  private cachedEntries: Child[] | null = null;

  // Signal for admission results
  admissionResults = signal<AdmissionResult[]>([]);
  schools = signal<{ id: number; name: string; free: number }[]>([]);
  uniqueChildren = signal<{ childNum: number; label: string }[]>([]);
  loading = signal(false);

  getSchools(): Observable<School[]> {
    return this.http.get<SchoolsResponse>('/api/schools').pipe(
      map(response => response.items)
    );
  }

  getChildren(schoolId: number): Observable<Child[]> {
    const updatedAt = new Date().toISOString();
    return this.http.get<ChildrenResponse>(
      `/api/waitlist-deep?school_id=${schoolId}&updated_at=${updatedAt}`
    ).pipe(
      map(response => response.items)
    );
  }

  getAllChildren(): Observable<Child[]> {
    return this.getSchools().pipe(
      switchMap(schools =>
        forkJoin(schools.map(school => this.getChildren(school.id)))
      ),
      map(results => results.flat())
    );
  }

  fetchAndSimulate(): Observable<AdmissionResult[]> {
    if (this.cachedEntries && this.cachedSchoolMap) {
      const results = this.simulateAdmission(this.cachedEntries, this.cachedSchoolMap);
      this.admissionResults.set(results);
      return of(results);
    }
    this.loading.set(true);
    return this.getSchools().pipe(
      switchMap(schools => {
        this.cachedSchoolMap = new Map(schools.map(s => [s.id, s]));
        this.schools.set(
          schools.map(s => ({ id: s.id, name: s.nameStr, free: s.free }))
            .sort((a, b) => a.name.localeCompare(b.name, 'bg'))
        );
        return forkJoin(
          schools.map(school => this.getChildren(school.id))
        ).pipe(
          map(childrenPerSchool => {
            this.cachedEntries = childrenPerSchool.flat();
            this.buildUniqueChildren();
            const results = this.simulateAdmission(this.cachedEntries, this.cachedSchoolMap!);
            this.admissionResults.set(results);
            this.loading.set(false);
            return results;
          })
        );
      })
    );
  }

  private buildUniqueChildren(): void {
    if (!this.cachedEntries) return;
    const seen = new Map<number, string>();
    for (const e of this.cachedEntries) {
      if (!seen.has(e.childNum)) {
        seen.set(e.childNum, e.name);
      }
    }
    this.uniqueChildren.set(
      [...seen.entries()].map(([childNum, name]) => ({
        childNum,
        label: `${childNum} - ${name}`,
      }))
    );
  }

  getChildWishes(childNum: number): ChildWish[] {
    if (!this.cachedEntries || !this.cachedSchoolMap) return [];
    return this.cachedEntries
      .filter(e => e.childNum === childNum)
      .sort((a, b) => a.wishOrder - b.wishOrder)
      .map(e => ({
        schoolId: e.schoolId,
        schoolName: this.cachedSchoolMap!.get(e.schoolId)?.nameStr ?? `Училище ${e.schoolId}`,
        wishOrder: e.wishOrder,
        points: e.points,
        order: e.order,
      }));
  }

  reorderWishes(childNum: number, newOrder: number[]): void {
    if (!this.cachedEntries || !this.cachedSchoolMap) return;

    this.loading.set(true);

    for (const schoolId of newOrder) {
      const entry = this.cachedEntries.find(
        e => e.childNum === childNum && e.schoolId === schoolId
      );
      if (entry) {
        entry.wishOrder = newOrder.indexOf(schoolId) + 1;
      }
    }

    setTimeout(() => {
      const results = this.simulateAdmission(this.cachedEntries!, this.cachedSchoolMap!);
      this.admissionResults.set(results);
      this.loading.set(false);
    });
  }

  getAdmissionResults(): Observable<AdmissionResult[]> {
    return this.fetchAndSimulate();
  }

  /** Връща всички желания на дете от резултатите, сортирани по wishOrder */
  getChildAdmissions(childNum: number): AdmissionResult[] {
    return this.admissionResults()
      .filter(r => r.childNum === childNum)
      .sort((a, b) => a.wishOrder - b.wishOrder);
  }

  /**
   * Извличане на номера на групата от displayText.
   * Групите са от 1 (Първа) до 4 (Четвърта). Ако не се разпознае — връща 5.
   */
  private extractGroup(displayText: string): number {
    if (displayText.includes('Първа група')) return 1;
    if (displayText.includes('Втора група')) return 2;
    if (displayText.includes('Трета група')) return 3;
    if (displayText.includes('Четвърта група')) return 4;
    return 5;
  }

  /**
   * Симулация на класирането по алгоритъма от Наредбата
   * (https://kg.sofia.bg/#/faq/114):
   *
   * 1. За ВСЯКО училище поотделно, кандидатите се подреждат по:
   *    - Група (1→4, по-малка = по-висок приоритет)
   *    - Точки от допълнителни критерии (низходящо)
   *    - При равенство (гранична група) — по азбучен ред на името
   *
   * 2. Итеративно класиране:
   *    - За всяко училище се приемат top-N кандидати, като се пропускат
   *      вече класирани на по-високо желание деца.
   *    - Ако дете се класира на по-високо желание, освобождава място
   *      в по-ниското, което се запълва от следващия в реда.
   *    - Повтаря се до стабилизиране.
   *
   * Резултатът съдържа ПО ЕДИН запис за ВСЯКО желание на ВСЯКО дете,
   * с admitted=true/false за всяко.
   */
  private simulateAdmission(
    allEntries: Child[],
    schoolMap: Map<number, School>
  ): AdmissionResult[] {
    // Group entries by school
    const entriesBySchool = new Map<number, Child[]>();
    for (const entry of allEntries) {
      const list = entriesBySchool.get(entry.schoolId) ?? [];
      list.push(entry);
      entriesBySchool.set(entry.schoolId, list);
    }

    // Sort candidates per school: group asc → points desc → name alphabetical (bg)
    for (const [, entries] of entriesBySchool) {
      entries.sort((a, b) => {
        const groupA = this.extractGroup(a.displayText);
        const groupB = this.extractGroup(b.displayText);
        if (groupA !== groupB) return groupA - groupB;
        if (a.points !== b.points) return b.points - a.points;
        return a.name.localeCompare(b.name, 'bg');
      });
    }

    // Group all entries by child for wish priority lookups
    const entriesByChild = new Map<number, Child[]>();
    for (const entry of allEntries) {
      const list = entriesByChild.get(entry.childNum) ?? [];
      list.push(entry);
      entriesByChild.set(entry.childNum, list);
    }

    // Iterative placement: placed maps childNum -> schoolId
    const placed = new Map<number, number>();

    let changed = true;
    while (changed) {
      changed = false;

      for (const [schoolId, candidates] of entriesBySchool) {
        const capacity = schoolMap.get(schoolId)?.free ?? 0;
        let spotsUsed = 0;

        for (const candidate of candidates) {
          if (spotsUsed >= capacity) break;

          const existingSchoolId = placed.get(candidate.childNum);

          if (existingSchoolId === schoolId) {
            // Already placed here — count towards capacity
            spotsUsed++;
            continue;
          }

          if (existingSchoolId !== undefined) {
            // Already placed at another school — compare wish orders
            const childEntries = entriesByChild.get(candidate.childNum)!;
            const thisWish = childEntries.find(e => e.schoolId === schoolId)?.wishOrder ?? Infinity;
            const existingWish = childEntries.find(e => e.schoolId === existingSchoolId)?.wishOrder ?? Infinity;

            if (thisWish >= existingWish) {
              // Already at an equal or higher wish school — skip without using a spot
              continue;
            }

            // This school is a higher wish — move child here
            placed.set(candidate.childNum, schoolId);
            spotsUsed++;
            changed = true;
          } else {
            // Not placed anywhere — place here
            placed.set(candidate.childNum, schoolId);
            spotsUsed++;
          }
        }
      }
    }

    // Build full results: one row per child-wish combination
    const results: AdmissionResult[] = [];
    for (const [childNum, entries] of entriesByChild) {
      for (const entry of entries) {
        const school = schoolMap.get(entry.schoolId);
        results.push({
          childNum: entry.childNum,
          name: entry.name,
          schoolId: entry.schoolId,
          schoolName: school?.nameStr ?? `Училище ${entry.schoolId}`,
          schoolCapacity: school?.free ?? 0,
          points: entry.points,
          wishOrder: entry.wishOrder,
          order: entry.order,
          group: this.extractGroup(entry.displayText),
          displayText: entry.displayText,
          admitted: placed.get(childNum) === entry.schoolId,
        });
      }
    }

    // Sort: by child name, then by wish order
    results.sort((a, b) => {
      if (a.schoolName !== b.schoolName) return a.schoolName.localeCompare(b.schoolName, 'bg');
      if (a.group !== b.group) return a.group - b.group;
      if (a.points !== b.points) return b.points - a.points;
      return a.name.localeCompare(b.name, 'bg');
    });

    return results;
  }
}
