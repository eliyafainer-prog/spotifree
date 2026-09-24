import React from 'react';
import { X, Headphones, CheckCircle2, BatteryCharging, Smartphone, Radio } from 'lucide-react';

export function BackgroundAudioModal({ isOpen, onClose }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-fadeIn select-none">
      <div className="bg-spotify-elevated border border-spotify-border rounded-2xl w-full max-w-md p-6 flex flex-col gap-5 shadow-2xl relative animate-slideUp text-right" dir="rtl">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 left-4 p-2 text-spotify-subtext hover:text-white transition-colors rounded-full hover:bg-white/10"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center flex-shrink-0 shadow-inner">
            <Headphones className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">ניגון ברקע ומסך נעילה</h2>
            <p className="text-xs text-spotify-subtext">מוזיקה רציפה בכיס ועם אוזניות 🎧</p>
          </div>
        </div>

        {/* Status Badge */}
        <div className="flex items-center gap-2.5 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-emerald-400" />
          <span>מנוע הזרמת השמע הישיר (Native Audio) פעיל ומחובר למסך הנעילה.</span>
        </div>

        {/* Feature List */}
        <div className="flex flex-col gap-3 text-xs text-spotify-subtext">
          <div className="flex items-start gap-3 bg-spotify-dark p-3 rounded-xl border border-white/5">
            <Radio className="w-4 h-4 text-spotify-green flex-shrink-0 mt-0.5" />
            <div>
              <span className="font-bold text-white block mb-0.5">כפתורי אוזניות (בלוטוס וחוטי):</span>
              <ul className="list-disc list-inside space-y-0.5 text-[11px] text-gray-300">
                <li>לחיצה בודדת: השמעה / עצירה (Play / Pause)</li>
                <li>לחיצה כפולה: מעבר לשיר הבא (Next)</li>
                <li>לחיצה משולשת: חזרה לשיר הקודם (Previous)</li>
                <li>ניתוק אוזניות: עצירה אוטומטית למניעת מבוכה ברמקול</li>
              </ul>
            </div>
          </div>

          <div className="flex items-start gap-3 bg-spotify-dark p-3 rounded-xl border border-white/5">
            <BatteryCharging className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <span className="font-bold text-white block mb-0.5">טיפ קריטי לאנדרואיד (למניעת השהייה):</span>
              <p className="text-[11px] leading-relaxed text-gray-300">
                כדי שאנדרואיד לא "ירדים" את הדפדפן בזמן שהמסך כבוי זמן רב:
                <br />
                כנס ל<strong>הגדרות הטלפון &gt; יישומים &gt; הדפדפן שלך (Chrome / סמסונג) &gt; סוללה</strong> ובחר <strong>"ללא הגבלה" (Unrestricted)</strong>.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 bg-spotify-dark p-3 rounded-xl border border-white/5">
            <Smartphone className="w-4 h-4 text-sky-400 flex-shrink-0 mt-0.5" />
            <div>
              <span className="font-bold text-white block mb-0.5">למשתמשי Samsung Internet:</span>
              <p className="text-[11px] leading-relaxed text-gray-300">
                פתח תפריט דפדפן (3 פסים) &gt; <strong>הגדרות</strong> &gt; <strong>תכונות שימושיות</strong> &gt; הפעל את <strong>"ניגון ברקע" (Background play)</strong>.
              </p>
            </div>
          </div>
        </div>

        {/* Close Button */}
        <button
          onClick={onClose}
          className="w-full py-2.5 rounded-full bg-spotify-green hover:bg-spotify-green-hover text-black font-bold text-sm transition-transform active:scale-95 shadow-lg shadow-spotify-green/20"
        >
          הבנתי, תודה!
        </button>
      </div>
    </div>
  );
}
