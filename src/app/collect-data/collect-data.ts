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

  schoolChildren = computed(() => {
    const schoolId = this.selectedSchoolId();
    if (schoolId === null) return [];
    return this.dataService.admissionResults()
      .filter(r => r.schoolId === schoolId);
  });

  schoolHeader = computed(() => {
    const children = this.schoolChildren();
    if (children.length === 0) return '';
    const guaranteed = children.filter(r => r.admissionStatus === 'guaranteed').length;
    const chance = children.filter(r => r.admissionStatus === 'chance').length;
    const elsewhere = children.filter(r => r.admissionStatus === 'admitted-elsewhere').length;
    return `Гарантирани: ${guaranteed} | Шанс: ${chance} | Другаде: ${elsewhere} / ${children[0].schoolCapacity} места`;
  });

  rowClasses: Record<string, (row: any) => boolean> = {
    'row-guaranteed': (row) => row.data?.admissionStatus === 'guaranteed',
    'row-elsewhere': (row) => row.data?.admissionStatus === 'admitted-elsewhere',
    'row-chance': (row) => row.data?.admissionStatus === 'chance',
    'row-impossible': (row) => row.data?.admissionStatus === 'impossible',
  };

  ngOnInit(): void {
    this.dataService.fetchAndSimulate().subscribe();
  }

  onSchoolSelected(event: ISimpleComboSelectionChangingEventArgs): void {
    this.selectedSchoolId.set(event.newValue as number ?? null);
  }

  getChildWishes(childNum: number): AdmissionResult[] {
    return this.dataService.getChildAdmissions(childNum);
  }

  formatStatus(status: string, chance: number): string {
    switch (status) {
      case 'guaranteed': return '✔ Класиран';
      case 'admitted-elsewhere': return '↗ Другаде';
      case 'chance': return `⚄ Шанс ${chance}%`;
      case 'impossible': return '✘ Не';
      default: return status;
    }
  }
}
