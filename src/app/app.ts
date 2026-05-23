import { Component, DestroyRef, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink, RouterOutlet } from '@angular/router';
import {
  IgxNavigationDrawerComponent,
  IgxNavDrawerItemDirective,
  IgxNavDrawerTemplateDirective
} from '@infragistics/igniteui-angular/navigation-drawer';
import { IGX_SIMPLE_COMBO_DIRECTIVES, ISimpleComboSelectionChangingEventArgs } from '@infragistics/igniteui-angular/simple-combo';
import { IgxButtonDirective, IgxRippleDirective, IgxIconButtonDirective } from '@infragistics/igniteui-angular/directives';
import { IgxIconComponent } from '@infragistics/igniteui-angular/icon';
import { IgxSwitchComponent } from '@infragistics/igniteui-angular/switch';
import { HttpClient } from '@angular/common/http';
import { Data } from './data';
import { ChildWish } from './models';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, FormsModule,
    IgxNavigationDrawerComponent, IgxNavDrawerItemDirective, IgxNavDrawerTemplateDirective,
    IGX_SIMPLE_COMBO_DIRECTIVES, IgxButtonDirective, IgxRippleDirective, IgxIconButtonDirective, IgxIconComponent,
    IgxSwitchComponent
  ],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  protected readonly title = signal('school');
  protected dataService = inject(Data);
  private http = inject(HttpClient);
  private destroyRef = inject(DestroyRef);

  selectedChildNum = signal<number | null>(null);
  wishes = signal<ChildWish[]>([]);

  collectStatus = signal<'idle' | 'collecting' | 'done' | 'error'>('idle');
  collectMessage = signal('');
  collectCurrent = signal(0);
  collectTotal = signal(0);

  onChildSelected(event: ISimpleComboSelectionChangingEventArgs): void {
    const childNum = event.newValue as number;
    if (!childNum) {
      this.selectedChildNum.set(null);
      this.wishes.set([]);
      return;
    }
    this.selectedChildNum.set(childNum);
    this.wishes.set(this.dataService.getChildWishes(childNum));
  }

  moveUp(index: number): void {
    const current = [...this.wishes()];
    if (index <= 0) return;
    [current[index - 1], current[index]] = [current[index], current[index - 1]];
    this.wishes.set(current);
  }

  moveDown(index: number): void {
    const current = [...this.wishes()];
    if (index >= current.length - 1) return;
    [current[index], current[index + 1]] = [current[index + 1], current[index]];
    this.wishes.set(current);
  }

  recalculate(): void {
    const childNum = this.selectedChildNum();
    if (!childNum) return;
    const newOrder = this.wishes().map(w => w.schoolId);
    this.dataService.reorderWishes(childNum, newOrder);
  }

  startCollection(): void {
    if (this.collectStatus() === 'collecting') return;

    this.collectStatus.set('collecting');
    this.collectMessage.set('Стартиране...');
    this.collectCurrent.set(0);
    this.collectTotal.set(0);
    this.dataService.clearForCollection();

    this.http.post<{ started: boolean }>('/api/sync', {}).subscribe({
      next: () => this.pollStatus(),
      error: (err) => {
        console.error('Sync POST failed:', err);
        this.collectStatus.set('error');
        this.collectMessage.set(`Неуспешна връзка: ${err.status} ${err.statusText ?? err.message ?? 'unknown'}`);
      },
    });
  }

  private pollStatus(): void {
    const interval = setInterval(() => {
      this.http.get<{ status: string; current: number; total: number; message: string }>(
        '/api/sync/status'
      ).subscribe({
        next: (data) => {
          this.collectMessage.set(data.message ?? '');
          this.collectCurrent.set(data.current ?? 0);
          this.collectTotal.set(data.total ?? 0);

          if (data.status === 'done') {
            this.collectStatus.set('done');
            clearInterval(interval);
            this.dataService.reload();
          } else if (data.status === 'error') {
            this.collectStatus.set('error');
            clearInterval(interval);
          }
        },
        error: () => {
          this.collectStatus.set('error');
          this.collectMessage.set('Връзката със сървъра е прекъсната');
          clearInterval(interval);
        },
      });
    }, 1000);

    this.destroyRef.onDestroy(() => clearInterval(interval));
  }

  toggleLottery(): void {
    this.dataService.toggleLottery();
  }
}
