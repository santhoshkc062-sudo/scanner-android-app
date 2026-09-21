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

  it('should render the stage the loop builds into', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    // The engine needs these three to exist before it can build anything; if a
    // future edit to app.html drops one, the board comes up empty and silent.
    expect(compiled.querySelector('#fit')).toBeTruthy();
    expect(compiled.querySelector('#stage')).toBeTruthy();
    expect(compiled.querySelector('#area')).toBeTruthy();
  });
});
