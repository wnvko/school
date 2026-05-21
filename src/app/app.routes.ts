import { Routes } from '@angular/router';
import { CollectData } from './collect-data/collect-data';

export const routes: Routes = [
  { path: '', component: CollectData },
  { path: 'collect-data', component: CollectData },
];
