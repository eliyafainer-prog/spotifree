# 🚀 SpotiFree — מדריך העלאה לענן חינמי (24/7 ללא צורך במחשב דלוק)

מדריך זה מסביר צעד-אחר-צעד כיצד להעלות את **SpotiFree** לענן חינמי, כך שהאפליקציה תפעל בטלפון שלך תמיד — 24 שעות ביממה, 365 ימים בשנה, גם כשהמחשב שלך כבוי לחלוטין.

הכל **100% חינם** וללא שום צורך בהזנת כרטיס אשראי!

---

## שלב 1: יצירת מאגר (Repository) ב-GitHub

1. היכנס לחשבון שלך ב-GitHub: [https://github.com/new](https://github.com/new)
2. בשם המאגר (Repository name) כתוב: **`spotifree`**
3. בחר **Public** (ציבורי) או **Private** (פרטי).
4. **אל תסמן** שום קובץ ראשוני (ללא README, ללא .gitignore).
5. לחץ על **Create repository**.
6. העתק את כתובת ה-URL של המאגר (לדוגמה: `https://github.com/appleGames1/spotifree.git`).

---

## שלב 2: דחיפת הקוד מהמחשב ל-GitHub

בטרמינל או בחלון PowerShell בתיקיית הפרויקט, הרץ את הפקודות הבאות (החלף בכתובת המאגר שלך):

```bash
git remote add origin https://github.com/appleGames1/spotifree.git
git branch -M main
git push -u origin main
```

---

## שלב 3: חיבור לענן חינמי (בחר אחת מהאפשרויות)

### 🥇 אפשרות א': Render.com (הכי מומלץ ופשוט - כולל דומיין קבוע חינם)
1. היכנס לאתר: **[https://render.com](https://render.com)** והירשם בחינם עם חשבון ה-GitHub שלך (Sign in with GitHub).
2. לחץ על **New +** ובחר **Web Service**.
3. בחר ב-**Build and deploy from a Git repository** ובחר במאגר **`spotifree`**.
4. שדות ההגדרה יתמלאו אוטומטית מקובץ ה-`render.yaml` וה-`Dockerfile` שהכנו עבורך:
   - **Name:** `spotifree`
   - **Runtime:** `Docker`
   - **Instance Type:** `Free` (0$/month)
5. לחץ על **Deploy Web Service**!

תוך כ-2-3 דקות האפליקציה תהיה באוויר בענן עם כתובת קבועה ומאובטחת:
👉 **`https://spotifree.onrender.com`**

---

### 🥈 אפשרות ב': Koyeb (ללא מצב שינה)
1. היכנס ל-**[https://www.koyeb.com](https://www.koyeb.com)** והירשם חינם עם GitHub.
2. לחץ **Create App** ובחר **GitHub**.
3. בחר במאגר `spotifree` (הוא יזהה אוטומטית את ה-`Dockerfile`).
4. לחץ **Deploy**.

---

## 🎉 זה הכל!
מעכשיו:
- האפליקציה רצה על שרתי ענן 24/7.
- תוכל להיכנס מכל טלפון או מחשב בעולם ללא תלות במחשב הביתי שלך!
- הכתובת קבועה לתמיד ולא משתנה לעולם.
