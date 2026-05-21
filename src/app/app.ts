import { Component, inject, signal } from '@angular/core';
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
import { ChildWish, Data } from './data';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, FormsModule,
    IgxNavigationDrawerComponent, IgxNavDrawerItemDirective, IgxNavDrawerTemplateDirective,
    IGX_SIMPLE_COMBO_DIRECTIVES, IgxButtonDirective, IgxRippleDirective, IgxIconButtonDirective, IgxIconComponent
  ],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  protected readonly title = signal('school');
  protected dataService = inject(Data);

  selectedChildNum = signal<number | null>(null);
  wishes = signal<ChildWish[]>([]);

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
}
