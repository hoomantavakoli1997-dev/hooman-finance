import { registerRootComponent } from 'expo';
import { registerWidgetTaskHandler } from 'react-native-android-widget';
import App from './App';
import './bg/alerts-task';
import { widgetTaskHandler } from './widget/widget-task-handler';

// registerRootComponent همان کاری را می‌کند که ورودی پیش‌فرض Expo می‌کرد
registerRootComponent(App);
registerWidgetTaskHandler(widgetTaskHandler);
