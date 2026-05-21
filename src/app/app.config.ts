import { ApplicationConfig, LOCALE_ID, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { changei18n } from '@infragistics/igniteui-angular/core';

import { routes } from './app.routes';
import { provideAnimations } from '@angular/platform-browser/animations';
import { ResourceStringsBG } from './i18n/bg-resources';

changei18n(ResourceStringsBG);

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(),
    provideAnimations(),
    { provide: LOCALE_ID, useValue: 'bg' },
  ],
};
