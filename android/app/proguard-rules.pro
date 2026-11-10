-keep class org.bouncycastle.** { *; }
-dontwarn org.bouncycastle.**
-dontwarn javax.naming.**
-dontwarn java.beans.**
-keep class com.google.mlkit.** { *; }
-keep class com.google.android.gms.internal.mlkit_** { *; }
-keep class com.google.android.odml.** { *; }
-dontwarn com.google.mlkit.**
-keep class com.tom_roush.** { *; }
-dontwarn com.tom_roush.**
-dontwarn com.gemalto.jp2.**

# the web editors call these methods from the page; they must keep their names
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class com.apexoffice.android.ui.DocsHost { *; }
