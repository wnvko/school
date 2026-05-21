import { HttpClient } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { Observable, forkJoin, of } from 'rxjs';
import { map, switchMap, tap } from 'rxjs/operators';

export interface School {
  id: number;
  nameStr: string;
  region: string;
  free: number;
  signed: number;
  unsigned: number;
  capacity: number;
  available: number;
}

export interface OtherSchool {
  schoolId: number;
  points: number;
  wishOrder: number;
}

export interface Child {
  id: number;
  schoolId: number;
  childNum: number;
  name: string;
  displayText: string;
  points: number;
  wishOrder: number;
  order: number;
  otherSchools: OtherSchool[];
}

export interface AdmittedChild {
  childNum: number;
  name: string;
  schoolId: number;
  schoolName: string;
  schoolCapacity: number;
  points: number;
  wishOrder: number;
  order: number;
  displayText: string;
  admitted: boolean;
}

export interface ChildWish {
  schoolId: number;
  schoolName: string;
  wishOrder: number;
  points: number;
  order: number;
}

interface SchoolsResponse {
  items: School[];
}

interface ChildrenResponse {
  items: Child[];
}

@Injectable({
  providedIn: 'root',
})
export class Data {
  private http = inject(HttpClient);

  // Cached data
  private cachedSchoolMap: Map<number, School> | null = null;
  private cachedEntries: Child[] | null = null;

  // Signal for admission results
  admissionResults = signal<AdmittedChild[]>([]);
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

  fetchAndSimulate(): Observable<AdmittedChild[]> {
    if (this.cachedEntries && this.cachedSchoolMap) {
      const results = this.simulateAdmission(this.cachedEntries, this.cachedSchoolMap);
      this.admissionResults.set(results);
      return of(results);
    }
    this.loading.set(true);
    return this.getSchools().pipe(
      switchMap(schools => {
        this.cachedSchoolMap = new Map(schools.map(s => [s.id, s]));
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
        schoolName: this.cachedSchoolMap!.get(e.schoolId)?.nameStr ?? `School ${e.schoolId}`,
        wishOrder: e.wishOrder,
        points: e.points,
        order: e.order,
      }));
  }

  reorderWishes(childNum: number, newOrder: number[]): void {
    if (!this.cachedEntries || !this.cachedSchoolMap) return;

    this.loading.set(true);

    // newOrder is array of schoolIds in new wish order
    // Update wishOrder for the target child's entries
    for (const schoolId of newOrder) {
      const entry = this.cachedEntries.find(
        e => e.childNum === childNum && e.schoolId === schoolId
      );
      if (entry) {
        entry.wishOrder = newOrder.indexOf(schoolId) + 1;
      }
    }

    // Re-run simulation async to allow loading indicator to render
    setTimeout(() => {
      const results = this.simulateAdmission(this.cachedEntries!, this.cachedSchoolMap!);
      this.admissionResults.set(results);
      this.loading.set(false);
    });
  }

  getAdmissionResults(): Observable<AdmittedChild[]> {
    return this.fetchAndSimulate();
  }

  private simulateAdmission(
    allEntries: Child[],
    schoolMap: Map<number, School>
  ): AdmittedChild[] {
    // Group all entries by child (childNum)
    const childEntries = new Map<number, Child[]>();
    for (const entry of allEntries) {
      const entries = childEntries.get(entry.childNum) ?? [];
      entries.push(entry);
      childEntries.set(entry.childNum, entries);
    }

    // For each child, sort their entries by wishOrder
    for (const entries of childEntries.values()) {
      entries.sort((a, b) => a.wishOrder - b.wishOrder);
    }

    // Find max wish order across all children
    let maxWish = 0;
    for (const entries of childEntries.values()) {
      for (const e of entries) {
        if (e.wishOrder > maxWish) maxWish = e.wishOrder;
      }
    }

    // Initialize remaining capacity per school
    const remainingCapacity = new Map<number, number>();
    for (const [id, school] of schoolMap) {
      remainingCapacity.set(id, school.free);
    }

    // Track admitted children: childNum -> AdmittedChild result
    const admittedMap = new Map<number, AdmittedChild>();

    // Process wish rounds: all wish-1 first, then wish-2, etc.
    for (let wish = 1; wish <= maxWish; wish++) {
      // Group unplaced children by school for this wish level
      const schoolCandidates = new Map<number, Child[]>();

      for (const [childNum, entries] of childEntries) {
        if (admittedMap.has(childNum)) continue; // already placed
        const entry = entries.find(e => e.wishOrder === wish);
        if (!entry) continue; // no entry for this wish
        const candidates = schoolCandidates.get(entry.schoolId) ?? [];
        candidates.push(entry);
        schoolCandidates.set(entry.schoolId, candidates);
      }

      // For each school, sort candidates by order (ascending = best ranked first)
      // and admit until capacity is exhausted
      for (const [schoolId, candidates] of schoolCandidates) {
        candidates.sort((a, b) => a.order - b.order);
        let remaining = remainingCapacity.get(schoolId) ?? 0;

        for (const candidate of candidates) {
          if (remaining <= 0) break;
          if (admittedMap.has(candidate.childNum)) continue;

          const school = schoolMap.get(schoolId);
          admittedMap.set(candidate.childNum, {
            childNum: candidate.childNum,
            name: candidate.name,
            schoolId: schoolId,
            schoolName: school?.nameStr ?? `School ${schoolId}`,
            schoolCapacity: school?.free ?? 0,
            points: candidate.points,
            wishOrder: candidate.wishOrder,
            order: candidate.order,
            displayText: candidate.displayText,
            admitted: true,
          });
          remaining--;
        }
        remainingCapacity.set(schoolId, remaining);
      }
    }

    // Collect results: admitted children + unadmitted children
    const results: AdmittedChild[] = [...admittedMap.values()];

    // Add unadmitted children (show with their first wish info)
    for (const [childNum, entries] of childEntries) {
      if (admittedMap.has(childNum)) continue;
      const firstEntry = entries[0];
      const school = schoolMap.get(firstEntry.schoolId);
      results.push({
        childNum: firstEntry.childNum,
        name: firstEntry.name,
        schoolId: firstEntry.schoolId,
        schoolName: school?.nameStr ?? `School ${firstEntry.schoolId}`,
        schoolCapacity: school?.free ?? 0,
        points: firstEntry.points,
        wishOrder: firstEntry.wishOrder,
        order: firstEntry.order,
        displayText: firstEntry.displayText,
        admitted: false,
      });
    }

    // Sort results by school, then by order within school
    results.sort((a, b) => {
      if (a.schoolName !== b.schoolName) return a.schoolName.localeCompare(b.schoolName, 'bg');
      return a.order - b.order;
    });

    return results;
  }

  private extractGroup(displayText: string): number {
    if (displayText.includes('Първа група')) return 1;
    if (displayText.includes('Втора група')) return 2;
    if (displayText.includes('Трета група')) return 3;
    if (displayText.includes('Четвърта група')) return 4;
    return 5;
  }
}
