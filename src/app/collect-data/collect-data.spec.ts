import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CollectData } from './collect-data';

describe('CollectData', () => {
  let component: CollectData;
  let fixture: ComponentFixture<CollectData>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CollectData],
    }).compileComponents();

    fixture = TestBed.createComponent(CollectData);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
