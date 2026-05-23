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
  lotteryMode = signal(false);

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

  /** Изчиства кеша преди събиране на данни */
  clearForCollection(): void {
    this.cachedSchoolMap = null;
    this.cachedEntries = null;
    this.admissionResults.set([]);
    this.schools.set([]);
    this.uniqueChildren.set([]);
    this.loading.set(true);
    this.lotteryMode.set(false);
  }

  /** Превключва между режим на лотария и вероятностен режим */
  toggleLottery(): void {
    if (!this.cachedEntries || !this.cachedSchoolMap) return;
    const newMode = !this.lotteryMode();
    this.lotteryMode.set(newMode);
    this.loading.set(true);
    setTimeout(() => {
      if (newMode) {
        this.runLottery();
      } else {
        const results = this.simulateAdmission(this.cachedEntries!, this.cachedSchoolMap!);
        this.admissionResults.set(results);
      }
      this.loading.set(false);
    });
  }

  /** Презарежда данните след събиране */
  reload(): void {
    this.cachedSchoolMap = null;
    this.cachedEntries = null;
    this.fetchAndSimulate().subscribe();
  }

  /**
   * Извличане на номера на групата от displayText.
   */
  private extractGroup(displayText: string): number {
    if (displayText.includes('Първа група')) return 1;
    if (displayText.includes('Втора група')) return 2;
    if (displayText.includes('Трета група')) return 3;
    if (displayText.includes('Четвърта група')) return 4;
    return 5;
  }

  /**
   * Симулация на класирането.
   *
   * Итеративен алгоритъм:
   * 1. За всяко училище кандидатите се подреждат по група (възх.) и точки (низх.).
   * 2. Граничната позиция определя кои са гарантирани / шанс / невъзможни.
   * 3. Деца, гарантирани на по-предно желание, се маркират 'admitted-elsewhere'
   *    и се изключват от списъците на по-задните училища.
   * 4. Стъпки 2-3 се повтарят докато няма промяна (деца, напуснали училище,
   *    освобождават места и могат да превърнат 'chance' в 'guaranteed').
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

    // Sort candidates per school: group asc → points desc
    for (const [, entries] of entriesBySchool) {
      entries.sort((a, b) => {
        const gA = this.extractGroup(a.displayText);
        const gB = this.extractGroup(b.displayText);
        if (gA !== gB) return gA - gB;
        return b.points - a.points;
      });
    }

    // Group entries by child
    const entriesByChild = new Map<number, Child[]>();
    for (const entry of allEntries) {
      const list = entriesByChild.get(entry.childNum) ?? [];
      list.push(entry);
      entriesByChild.set(entry.childNum, list);
    }

    // Sort each child's entries by wish order
    for (const [, entries] of entriesByChild) {
      entries.sort((a, b) => a.wishOrder - b.wishOrder);
    }

    // Iterative resolution: remove admitted-elsewhere children and re-analyze
    // until stable (max 50 iterations as safety net)
    interface SchoolAnalysis { guaranteed: Set<number>; chance: Set<number>; chanceProb: number }
    let analysis = new Map<number, SchoolAnalysis>();
    const excludedFromSchool = new Map<number, Set<number>>(); // schoolId → set of childNums to exclude

    for (let iteration = 0; iteration < 50; iteration++) {
      analysis = new Map<number, SchoolAnalysis>();

      for (const [schoolId, allCandidates] of entriesBySchool) {
        const capacity = schoolMap.get(schoolId)?.free ?? 0;
        const excluded = excludedFromSchool.get(schoolId);
        const candidates = excluded
          ? allCandidates.filter(c => !excluded.has(c.childNum))
          : allCandidates;
        const guaranteed = new Set<number>();
        const chance = new Set<number>();

        if (capacity === 0 || candidates.length === 0) {
          analysis.set(schoolId, { guaranteed, chance, chanceProb: 0 });
          continue;
        }

        if (capacity >= candidates.length) {
          for (const c of candidates) guaranteed.add(c.childNum);
          analysis.set(schoolId, { guaranteed, chance, chanceProb: 100 });
          continue;
        }

        // Boundary = last person within capacity
        const bCandidate = candidates[capacity - 1];
        const bGroup = this.extractGroup(bCandidate.displayText);
        const bPoints = bCandidate.points;

        for (const c of candidates) {
          const cGroup = this.extractGroup(c.displayText);
          if (cGroup < bGroup || (cGroup === bGroup && c.points > bPoints)) {
            guaranteed.add(c.childNum);
          } else if (cGroup === bGroup && c.points === bPoints) {
            chance.add(c.childNum);
          }
        }

        const remainingSpots = capacity - guaranteed.size;
        const prob = chance.size > 0 ? Math.round((remainingSpots / chance.size) * 100) : 0;
        analysis.set(schoolId, { guaranteed, chance, chanceProb: Math.min(prob, 100) });
      }

      // Determine where each child is guaranteed (highest wish)
      const guaranteedAt = new Map<number, number>(); // childNum → schoolId
      for (const [childNum, entries] of entriesByChild) {
        for (const entry of entries) {
          if (analysis.get(entry.schoolId)?.guaranteed.has(childNum)) {
            guaranteedAt.set(childNum, entry.schoolId);
            break;
          }
        }
      }

      // Build exclusion lists: children guaranteed at a higher wish
      // should be excluded from lower-wish schools
      let changed = false;
      for (const [childNum, gSchoolId] of guaranteedAt) {
        const entries = entriesByChild.get(childNum)!;
        const gWish = entries.find(e => e.schoolId === gSchoolId)!.wishOrder;
        for (const entry of entries) {
          if (entry.wishOrder > gWish) {
            let set = excludedFromSchool.get(entry.schoolId);
            if (!set) {
              set = new Set();
              excludedFromSchool.set(entry.schoolId, set);
            }
            if (!set.has(childNum)) {
              set.add(childNum);
              changed = true;
            }
          }
        }
      }

      if (!changed) break;
    }

    // Final guaranteedAt after convergence
    const guaranteedAt = new Map<number, number>();
    for (const [childNum, entries] of entriesByChild) {
      for (const entry of entries) {
        if (analysis.get(entry.schoolId)?.guaranteed.has(childNum)) {
          guaranteedAt.set(childNum, entry.schoolId);
          break;
        }
      }
    }

    // Build results
    const results: AdmissionResult[] = [];
    for (const [, entries] of entriesByChild) {
      for (const entry of entries) {
        const school = schoolMap.get(entry.schoolId);
        const a = analysis.get(entry.schoolId)!;
        const gSchool = guaranteedAt.get(entry.childNum);

        let admissionStatus: AdmissionResult['admissionStatus'];
        let chance = 0;

        if (gSchool === entry.schoolId) {
          admissionStatus = 'guaranteed';
        } else if (gSchool !== undefined) {
          const gWish = entriesByChild.get(entry.childNum)!.find(e => e.schoolId === gSchool)!.wishOrder;
          if (entry.wishOrder > gWish) {
            admissionStatus = 'admitted-elsewhere';
          } else if (a.chance.has(entry.childNum)) {
            admissionStatus = 'chance';
            chance = a.chanceProb;
          } else if (a.guaranteed.has(entry.childNum)) {
            admissionStatus = 'guaranteed';
          } else {
            admissionStatus = 'impossible';
          }
        } else if (a.guaranteed.has(entry.childNum)) {
          admissionStatus = 'guaranteed';
        } else if (a.chance.has(entry.childNum)) {
          admissionStatus = 'chance';
          chance = a.chanceProb;
        } else {
          admissionStatus = 'impossible';
        }

        results.push({
          childNum: entry.childNum,
          name: entry.name.replaceAll(' ', ''),
          schoolId: entry.schoolId,
          schoolName: school?.nameStr ?? `Училище ${entry.schoolId}`,
          schoolCapacity: school?.free ?? 0,
          points: entry.points,
          wishOrder: entry.wishOrder,
          order: entry.order,
          group: this.extractGroup(entry.displayText),
          displayText: entry.displayText.replaceAll('</br>', '. '),
          admitted: admissionStatus === 'guaranteed',
          admissionStatus,
          chance,
        });
      }
    }

    results.sort((a, b) => {
      if (a.schoolName !== b.schoolName) return a.schoolName.localeCompare(b.schoolName, 'bg');
      if (a.group !== b.group) return a.group - b.group;
      if (a.points !== b.points) return b.points - a.points;
      return a.name.localeCompare(b.name, 'bg');
    });

    return results;
  }

  /**
   * Симулация на лотария: за всяко дете в зоната на шанса се генерира
   * случайно число. Децата с най-малко число печелят местата.
   * След лотарията се пуска пълно итеративно класиране.
   */
  private runLottery(): void {
    const allEntries = this.cachedEntries!;
    const schoolMap = this.cachedSchoolMap!;

      // Group by school, sort
      const entriesBySchool = new Map<number, Child[]>();
      for (const entry of allEntries) {
        const list = entriesBySchool.get(entry.schoolId) ?? [];
        list.push(entry);
        entriesBySchool.set(entry.schoolId, list);
      }
      for (const [, entries] of entriesBySchool) {
        entries.sort((a, b) => {
          const gA = this.extractGroup(a.displayText);
          const gB = this.extractGroup(b.displayText);
          if (gA !== gB) return gA - gB;
          return b.points - a.points;
        });
      }

      // Assign random numbers to lottery candidates per school
      // lotteryNumber: childNum → random (global, one per child)
      const lotteryNumber = new Map<number, number>();

      for (const [schoolId, candidates] of entriesBySchool) {
        const capacity = schoolMap.get(schoolId)?.free ?? 0;
        if (capacity === 0 || capacity >= candidates.length) continue;

        const bCandidate = candidates[capacity - 1];
        const bGroup = this.extractGroup(bCandidate.displayText);
        const bPoints = bCandidate.points;

        for (const c of candidates) {
          const cGroup = this.extractGroup(c.displayText);
          if (cGroup === bGroup && c.points === bPoints && !lotteryNumber.has(c.childNum)) {
            lotteryNumber.set(c.childNum, Math.random());
          }
        }
      }

      // Now sort per school: guaranteed first, then lottery winners by random number
      for (const [schoolId, candidates] of entriesBySchool) {
        const capacity = schoolMap.get(schoolId)?.free ?? 0;
        if (capacity === 0 || capacity >= candidates.length) continue;

        const bCandidate = candidates[capacity - 1];
        const bGroup = this.extractGroup(bCandidate.displayText);
        const bPoints = bCandidate.points;

        candidates.sort((a, b) => {
          const gA = this.extractGroup(a.displayText);
          const gB = this.extractGroup(b.displayText);
          if (gA !== gB) return gA - gB;
          if (a.points !== b.points) return b.points - a.points;
          // Within lottery zone: sort by random number
          const aLottery = (gA === bGroup && a.points === bPoints);
          const bLottery = (gB === bGroup && b.points === bPoints);
          if (aLottery && bLottery) {
            return (lotteryNumber.get(a.childNum) ?? 0) - (lotteryNumber.get(b.childNum) ?? 0);
          }
          return 0;
        });
      }

      // Now run iterative placement with the sorted order
      const entriesByChild = new Map<number, Child[]>();
      for (const entry of allEntries) {
        const list = entriesByChild.get(entry.childNum) ?? [];
        list.push(entry);
        entriesByChild.set(entry.childNum, list);
      }

      const placed = new Map<number, number>();
      let changed = true;
      while (changed) {
        changed = false;
        for (const [schoolId, candidates] of entriesBySchool) {
          const capacity = schoolMap.get(schoolId)?.free ?? 0;
          let spotsUsed = 0;
          for (const candidate of candidates) {
            if (spotsUsed >= capacity) break;
            const existing = placed.get(candidate.childNum);
            if (existing === schoolId) { spotsUsed++; continue; }
            if (existing !== undefined) {
              const thisWish = entriesByChild.get(candidate.childNum)!.find(e => e.schoolId === schoolId)?.wishOrder ?? Infinity;
              const existingWish = entriesByChild.get(candidate.childNum)!.find(e => e.schoolId === existing)?.wishOrder ?? Infinity;
              if (thisWish >= existingWish) continue;
              placed.set(candidate.childNum, schoolId);
              spotsUsed++;
              changed = true;
            } else {
              placed.set(candidate.childNum, schoolId);
              spotsUsed++;
            }
          }
        }
      }

      // Build results with lottery outcomes
      const results: AdmissionResult[] = [];
      for (const [, entries] of entriesByChild) {
        for (const entry of entries) {
          const school = schoolMap.get(entry.schoolId);
          const placedSchool = placed.get(entry.childNum);
          const isPlacedHere = placedSchool === entry.schoolId;
          const isPlacedElsewhere = placedSchool !== undefined && placedSchool !== entry.schoolId;
          let admissionStatus: AdmissionResult['admissionStatus'];

          if (isPlacedHere) {
            admissionStatus = 'guaranteed';
          } else if (isPlacedElsewhere) {
            const placedWish = entriesByChild.get(entry.childNum)!.find(e => e.schoolId === placedSchool)?.wishOrder ?? Infinity;
            admissionStatus = entry.wishOrder > placedWish ? 'admitted-elsewhere' : 'impossible';
          } else {
            admissionStatus = 'impossible';
          }

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
            admitted: isPlacedHere,
            admissionStatus,
            chance: 0,
          });
        }
      }

      results.sort((a, b) => {
        if (a.schoolName !== b.schoolName) return a.schoolName.localeCompare(b.schoolName, 'bg');
        if (a.group !== b.group) return a.group - b.group;
        if (a.points !== b.points) return b.points - a.points;
        return a.name.localeCompare(b.name, 'bg');
      });

      this.admissionResults.set(results);
  }
}
