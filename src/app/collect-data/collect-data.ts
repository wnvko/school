import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { IGX_GRID_DIRECTIVES } from '@infragistics/igniteui-angular/grids/grid';
import { IGX_SIMPLE_COMBO_DIRECTIVES, ISimpleComboSelectionChangingEventArgs } from '@infragistics/igniteui-angular/simple-combo';
import { Data } from '../data';
import { AdmissionResult } from '../models';

@Component({
  selector: 'app-collect-data',
  imports: [IGX_GRID_DIRECTIVES, IGX_SIMPLE_COMBO_DIRECTIVES],
  templateUrl: './collect-data.html',
  styleUrl: './collect-data.css',
})
export class CollectData implements OnInit {
  protected dataService = inject(Data);

  selectedSchoolId = signal<number | null>(null);

  /** Деца за избраното училище — по 1 ред на дете */
  schoolChildren = computed(() => {
    const schoolId = this.selectedSchoolId();
    if (schoolId === null) return [];
    return this.dataService.admissionResults()
      .filter(r => r.schoolId === schoolId);
  });

  /** Заглавие с брой приети / места */
  schoolHeader = computed(() => {
    const children = this.schoolChildren();
    if (children.length === 0) return '';
    const admitted = children.filter(r => r.admitted).length;
    return `Приети: ${admitted} / ${children[0].schoolCapacity} места`;
  });

  ngOnInit(): void {
    this.dataService.fetchAndSimulate().subscribe();
  }

  onSchoolSelected(event: ISimpleComboSelectionChangingEventArgs): void {
    this.selectedSchoolId.set(event.newValue as number ?? null);
  }

  getChildWishes(childNum: number): AdmissionResult[] {
    return this.dataService.getChildAdmissions(childNum);
  }
}
