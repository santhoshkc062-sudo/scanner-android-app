import { TestBed } from '@angular/core/testing';
import { AppComponent } from './app';

describe('AppComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renders a card for every station on the line', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelectorAll('.pl-anchor').length).toBe(2);
    expect(compiled.querySelectorAll('.pl-card').length).toBe(8);
  });

  it('derives the anchor and line totals from the stations', () => {
    const app = TestBed.createComponent(AppComponent).componentInstance;
    const [a, b] = app.anchors();

    expect([a.packed, a.target, a.pct]).toEqual([696, 1010, 69]);
    expect([b.packed, b.target, b.pct]).toEqual([869, 1390, 63]);
    expect(a.range).toBe('WS-01 – WS-04');

    const totals = app.totals();
    expect([totals.packed, totals.target, totals.pct]).toEqual([1565, 2400, 65]);
  });
});
