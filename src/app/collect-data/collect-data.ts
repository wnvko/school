import { Component, inject, OnInit } from '@angular/core';
import { IGX_GRID_DIRECTIVES } from '@infragistics/igniteui-angular/grids/grid';
import { Data, AdmittedChild } from '../data';

@Component({
  selector: 'app-collect-data',
  imports: [IGX_GRID_DIRECTIVES],
  templateUrl: './collect-data.html',
  styleUrl: './collect-data.css',
})
export class CollectData implements OnInit {
  protected dataService = inject(Data);

  ngOnInit(): void {
    this.dataService.fetchAndSimulate().subscribe();
  }

  countAdmitted(records: AdmittedChild[]): number {
    return records.filter(r => r.admitted).length;
  }
}
