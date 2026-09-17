import React, { useMemo } from 'react';
import { BarChart3, Clock, Flame, User, Sun, Moon, Sunrise, Sunset, Music, Sparkles } from 'lucide-react';
import { getAnalyticsReport } from '../services/analytics';

export function AnalyticsView() {
  const data = useMemo(() => getAnalyticsReport(), []);

  const maxHour = Math.max(1, ...data.hourlyCounts);

  return (
    <div className="flex flex-col gap-6 animate-fadeIn pb-16 select-none">
      {/* Header */}
      <div className="flex flex-col gap-1 p-6 bg-gradient-to-r from-emerald-950/60 via-spotify-elevated/40 to-transparent rounded-2xl border border-emerald-500/20 shadow-xl">
        <div className="flex items-center gap-2 text-spotify-green text-xs font-bold tracking-wider uppercase">
          <Sparkles className="w-4 h-4" />
          <span>SpotiFree Data Analytics</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-black text-white">
          ניתוח הרגלי ההאזנה שלך
        </h1>
        <p className="text-sm text-spotify-subtext mt-1">
          כל הנתונים מחושבים בזמן אמת ונשמרים בצורה מאובטחת ופרטית במכשיר שלך
        </p>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Total Hours */}
        <div className="bg-spotify-dark p-5 rounded-xl border border-spotify-border/40 flex flex-col gap-2 shadow-md">
          <div className="w-10 h-10 rounded-lg bg-emerald-500/10 text-spotify-green flex items-center justify-center">
            <Clock className="w-5 h-5" />
          </div>
          <span className="text-xs text-spotify-subtext font-medium">סה"כ זמן האזנה</span>
          <div className="flex items-baseline gap-1">
            <span className="text-2xl sm:text-3xl font-black text-white">{data.totalMinutes}</span>
            <span className="text-xs text-spotify-subtext">דקות ({data.totalHours} שעות)</span>
          </div>
        </div>

        {/* Card 2: Total Plays */}
        <div className="bg-spotify-dark p-5 rounded-xl border border-spotify-border/40 flex flex-col gap-2 shadow-md">
          <div className="w-10 h-10 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center">
            <Flame className="w-5 h-5" />
          </div>
          <span className="text-xs text-spotify-subtext font-medium">השמעות שירים</span>
          <div className="flex items-baseline gap-1">
            <span className="text-2xl sm:text-3xl font-black text-white">{data.totalPlays}</span>
            <span className="text-xs text-spotify-subtext">שירים הושמעו</span>
          </div>
        </div>

        {/* Card 3: Peak Hour */}
        <div className="bg-spotify-dark p-5 rounded-xl border border-spotify-border/40 flex flex-col gap-2 shadow-md">
          <div className="w-10 h-10 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center">
            <BarChart3 className="w-5 h-5" />
          </div>
          <span className="text-xs text-spotify-subtext font-medium">שעת שיא בהאזנה</span>
          <div className="flex items-baseline gap-1">
            <span className="text-2xl sm:text-3xl font-black text-white">{data.peakHour}</span>
            <span className="text-xs text-spotify-subtext">ביממה</span>
          </div>
        </div>

        {/* Card 4: Top Artist */}
        <div className="bg-spotify-dark p-5 rounded-xl border border-spotify-border/40 flex flex-col gap-2 shadow-md">
          <div className="w-10 h-10 rounded-lg bg-purple-500/10 text-purple-400 flex items-center justify-center">
            <User className="w-5 h-5" />
          </div>
          <span className="text-xs text-spotify-subtext font-medium">האמן המוביל</span>
          <span className="text-lg sm:text-xl font-bold text-white truncate">
            {data.topArtists[0]?.artist || 'עדיין אין מספיק נתונים'}
          </span>
        </div>
      </div>

      {/* Hourly Listening Distribution Bar Chart */}
      <div className="bg-spotify-dark p-6 rounded-xl border border-spotify-border/40 flex flex-col gap-4 shadow-md">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-spotify-green" />
            <span>התפלגות שעות ההאזנה לאורך היממה (24 שעות)</span>
          </h2>
          <span className="text-xs text-spotify-subtext font-mono">00:00 - 23:00</span>
        </div>

        <div className="flex items-end gap-1.5 h-40 pt-6 px-2 overflow-x-auto" dir="ltr">
          {data.hourlyCounts.map((count, hour) => {
            const heightPercent = maxHour > 0 ? (count / maxHour) * 100 : 0;
            const isPeak = count === maxHour && count > 0;

            return (
              <div key={hour} className="flex-1 flex flex-col items-center gap-2 min-w-[20px] group">
                <div className="w-full flex-1 flex items-end justify-center">
                  <div
                    style={{ height: `${Math.max(6, heightPercent)}%` }}
                    className={`w-full max-w-[16px] rounded-t transition-all duration-300 ${
                      isPeak
                        ? 'bg-spotify-green shadow-[0_0_10px_rgba(30,215,96,0.6)]'
                        : count > 0
                        ? 'bg-white/40 group-hover:bg-white/80'
                        : 'bg-white/10'
                    }`}
                  />
                </div>
                <span className="text-[9px] text-spotify-subtext font-mono">
                  {hour % 3 === 0 ? `${hour}:00` : ''}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Two-Column: Top Tracks & Top Artists */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Top Tracks */}
        <div className="bg-spotify-dark p-6 rounded-xl border border-spotify-border/40 flex flex-col gap-4 shadow-md">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Flame className="w-5 h-5 text-spotify-green" />
            <span>השירים המושמעים ביותר (Top Tracks)</span>
          </h2>

          {data.topTracks.length === 0 ? (
            <div className="p-8 text-center text-spotify-subtext text-sm">
              עדיין לא הושמעו שירים. התחל להאזין כדי לראות את הסטטיסטיקה האישית שלך!
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {data.topTracks.map((t, idx) => (
                <div key={idx} className="flex items-center justify-between p-2 rounded-lg bg-spotify-elevated/40 hover:bg-spotify-highlight/40 transition-colors">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <span className="w-5 font-mono text-xs font-bold text-spotify-subtext">#{idx + 1}</span>
                    <div className="w-10 h-10 rounded bg-spotify-dark overflow-hidden flex-shrink-0">
                      {t.thumbnail ? (
                        <img src={t.thumbnail} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-spotify-subtext">
                          <Music className="w-4 h-4" />
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col min-w-0 truncate text-right">
                      <span className="text-sm font-semibold text-white truncate">{t.title}</span>
                      <span className="text-xs text-spotify-subtext truncate">{t.artist}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 bg-spotify-green/10 text-spotify-green px-2.5 py-1 rounded-full text-xs font-bold font-mono">
                    <span>{t.count}</span>
                    <span className="text-[10px] font-normal">השמעות</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Top Artists & Time of Day */}
        <div className="flex flex-col gap-6">
          {/* Top Artists */}
          <div className="bg-spotify-dark p-6 rounded-xl border border-spotify-border/40 flex flex-col gap-4 shadow-md">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <User className="w-5 h-5 text-spotify-green" />
              <span>האמנים המובילים (Top Artists)</span>
            </h2>

            {data.topArtists.length === 0 ? (
              <div className="p-8 text-center text-spotify-subtext text-sm">
                עדיין אין נתונים.
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {data.topArtists.map((a, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-2 bg-spotify-elevated px-3.5 py-2 rounded-full border border-spotify-border/50 text-xs font-medium text-white"
                  >
                    <span className="w-2 h-2 rounded-full bg-spotify-green"></span>
                    <span className="font-bold">{a.artist}</span>
                    <span className="text-spotify-subtext font-mono">({a.count})</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Time of Day Breakdown */}
          <div className="bg-spotify-dark p-6 rounded-xl border border-spotify-border/40 flex flex-col gap-4 shadow-md">
            <h3 className="text-sm font-bold text-spotify-subtext uppercase tracking-wider">
              זמני האזנה מועדפים ביממה
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="flex flex-col items-center gap-1 p-3 bg-spotify-elevated/40 rounded-lg">
                <Sunrise className="w-5 h-5 text-amber-400" />
                <span className="text-xs font-semibold text-white">בוקר</span>
                <span className="text-xs text-spotify-subtext font-mono">{data.timeOfDay.morning} שירים</span>
              </div>
              <div className="flex flex-col items-center gap-1 p-3 bg-spotify-elevated/40 rounded-lg">
                <Sun className="w-5 h-5 text-yellow-400" />
                <span className="text-xs font-semibold text-white">צהריים</span>
                <span className="text-xs text-spotify-subtext font-mono">{data.timeOfDay.afternoon} שירים</span>
              </div>
              <div className="flex flex-col items-center gap-1 p-3 bg-spotify-elevated/40 rounded-lg">
                <Sunset className="w-5 h-5 text-orange-400" />
                <span className="text-xs font-semibold text-white">ערב</span>
                <span className="text-xs text-spotify-subtext font-mono">{data.timeOfDay.evening} שירים</span>
              </div>
              <div className="flex flex-col items-center gap-1 p-3 bg-spotify-elevated/40 rounded-lg">
                <Moon className="w-5 h-5 text-indigo-400" />
                <span className="text-xs font-semibold text-white">לילה</span>
                <span className="text-xs text-spotify-subtext font-mono">{data.timeOfDay.night} שירים</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
