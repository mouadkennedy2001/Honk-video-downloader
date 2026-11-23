# Wasel Downloader — APK بدون سيرفر

هذا المجلد يجهّز **APK يعمل بالكامل داخل الهاتف**: واجهة Electron نفسها تعمل داخل WebView عبر Capacitor، ومحرّك `yt-dlp` يعمل كبايثون مدمج داخل APK عبر Chaquopy. لا يوجد سيرفر، ولا Node.js على الهاتف، ولا اتصال بأي خدمة خارجية غير مواقع الفيديو نفسها.

لا يتضمن APK متصفحًا داخليًا أو شاشة إدارة الإضافات والجسر. افتح الموقع في متصفح خارجي ثم الصق الرابط أو استخدم المشاركة إلى Wasel Downloader. يتضمن قالب Android أيقونات التشغيل المتوافقة مع شاشات Android المختلفة.

## المتطلبات على جهاز البناء (ويندوز)

- Node.js **22+** (Capacitor 8). تحقق: `node -v`
- JDK **21**. تحقق: `java -version`
- Python **3.12** متاح عبر `py -3.12` (لديك بالفعل).
- Android SDK Command-line Tools (بدون Android Studio).
- لا تحتاج Rust.

> Chaquopy 17.2 يدعم Python 3.12، وسنثبّت الإصدار داخل التطبيق على 3.12. الـ ABIs المدعومة: `arm64-v8a` و `x86_64` فقط.

## 1) تثبيت Android SDK بدون Android Studio

1. نزّل **Android SDK Command-line Tools (latest)** من موقع Android Developer، وافك الضغط في مسار ثابت مثل:

   ```text
   C:\Android\Sdk
   ```

   يجب أن يصبح بداخله:

   ```text
   C:\Android\Sdk\cmdline-tools\latest\bin\sdkmanager.bat
   ```

2. اضبط متغيرات البيئة في PowerShell (أو من «خصائص النظام»):

   ```powershell
   setx ANDROID_HOME "C:\Android\Sdk"
   setx ANDROID_SDK_ROOT "C:\Android\Sdk"
   setx PATH "$env:PATH;C:\Android\Sdk\cmdline-tools\latest\bin;C:\Android\Sdk\platform-tools"
   ```

   ثم أعد فتح PowerShell.

3. اقبل التراخيص وثبّت الحزم المطلوبة:

   ```powershell
   sdkmanager --licenses
   sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0"
   ```

   في سؤال التراخيص اكتب `y` واضغط Enter لكل سؤال.

## 2) تجهيز المشروع

من جذر المستودع:

```powershell
npm install
npm run check
npm run check:mobile
cd mobile
npm install
npm run sync:web
npx cap add android
npm run android:apply
npm run check
```

`android:apply` ينسخ ملفات Java/Python/Manifest وأيقونات التطبيق ويعدّل Gradle لإضافة:

- Chaquopy `17.2.0`
- Python `3.12`
- `pip { install("yt-dlp") }`
- `abiFilters "arm64-v8a", "x86_64"`
- `minSdkVersion 24`

> إن كان `py -3.12` غير متاح، افتح `mobile/android/app/build.gradle` وعدّل سطر `buildPython(...)` إلى المسار الكامل لـ Python 3.12.

## 3) بناء الـ APK

```powershell
cd mobile/android
gradlew.bat assembleDebug
```

أو من جذر المستودع (بعد `npx cap add android` مرة واحدة):

```powershell
npm run apk:build
```

الناتج:

```text
mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

ثبّته على الهاتف عبر `adb install app-debug.apk` أو انسخه وافتحه.

## 4) إعادة البناء بعد تعديل الواجهة

```powershell
npm --prefix mobile run sync:web
npm --prefix mobile run android:sync
npm --prefix mobile run android:apply
cd mobile/android
gradlew.bat assembleDebug
```

أو باختصار:

```powershell
npm run apk:build
```

## ملاحظات مهمة

- التحميل يستخدم صيغ **progressive** (فيديو + صوت في ملف واحد) لتفادي الاعتماد على FFmpeg داخل APK. لذلك قد لا تتوافق أعلى دقة مع صوت مدمج في بعض المواقع؛ سيتم اختيار أفضل صيغة متاحة بدون دمج.
- ميزة الدمج/تحويل الصوت تحتاج FFmpegKit ويمكن إضافتها لاحقًا اختياريًا.
- فتح الروابط والمشاركة من تطبيقات الهاتف مفعّل عبر `ACTION_SEND` و `ACTION_VIEW` في `AndroidManifest.xml`.
- السجل والمفضلة والإحصائيات محفوظة في `localStorage` داخل WebView.
- البناء النهائي للمتجر يحتاج توقيع APK/Bundle؛ هذا الدليل ينتج APK تجريبيًا قابلًا للتثبيت مباشرة.
