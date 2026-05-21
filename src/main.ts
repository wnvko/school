import { registerLocaleData } from '@angular/common';
import localeBg from '@angular/common/locales/bg';
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

registerLocaleData(localeBg);

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
