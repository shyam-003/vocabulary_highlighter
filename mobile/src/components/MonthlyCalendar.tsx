import React, { useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, radius } from '../theme';

interface MonthlyCalendarProps {
  activityData: Record<string, number>;
  onSelectDate: (dateStr: string, count: number) => void;
}

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function MonthlyCalendar({ activityData, onSelectDate }: MonthlyCalendarProps) {
  const [currentDate, setCurrentDate] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const todayStr = (() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  })();

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const monthName = currentDate.toLocaleString('en-US', { month: 'long' });

  // Calculate min month (from earliest activityData date with count > 0) and max month (today)
  const today = new Date();
  const currentMaxYear = today.getFullYear();
  const currentMaxMonth = today.getMonth();

  const activityDates = Object.keys(activityData).filter((d) => (activityData[d] || 0) > 0).sort();
  let minYear = currentMaxYear;
  let minMonth = currentMaxMonth;

  if (activityDates.length > 0) {
    const earliestParts = activityDates[0].split('-');
    if (earliestParts.length === 3) {
      minYear = parseInt(earliestParts[0], 10);
      minMonth = parseInt(earliestParts[1], 10) - 1; // 0-indexed
    }
  }

  const canGoPrev = (year > minYear) || (year === minYear && month > minMonth);
  const canGoNext = (year < currentMaxYear) || (year === currentMaxYear && month < currentMaxMonth);

  // Navigation handlers
  const handlePrevMonth = () => {
    if (canGoPrev) {
      setCurrentDate(new Date(year, month - 1, 1));
    }
  };

  const handleNextMonth = () => {
    if (canGoNext) {
      setCurrentDate(new Date(year, month + 1, 1));
    }
  };

  // Build grid of days
  const firstDayOfWeek = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  const calendarCells: {
    dateStr: string;
    dayNum: number;
    isCurrentMonth: boolean;
    isToday: boolean;
    count: number;
  }[] = [];

  // 1. Previous month padding days
  for (let i = firstDayOfWeek - 1; i >= 0; i--) {
    const dayNum = daysInPrevMonth - i;
    const prevDate = new Date(year, month - 1, dayNum);
    const pY = prevDate.getFullYear();
    const pM = String(prevDate.getMonth() + 1).padStart(2, '0');
    const pD = String(dayNum).padStart(2, '0');
    const dateStr = `${pY}-${pM}-${pD}`;
    calendarCells.push({
      dateStr,
      dayNum,
      isCurrentMonth: false,
      isToday: dateStr === todayStr,
      count: activityData[dateStr] || 0,
    });
  }

  // 2. Current month days
  for (let d = 1; d <= daysInMonth; d++) {
    const mStr = String(month + 1).padStart(2, '0');
    const dStr = String(d).padStart(2, '0');
    const dateStr = `${year}-${mStr}-${dStr}`;
    calendarCells.push({
      dateStr,
      dayNum: d,
      isCurrentMonth: true,
      isToday: dateStr === todayStr,
      count: activityData[dateStr] || 0,
    });
  }

  // 3. Next month padding days to complete 7-column rows
  const remaining = 7 - (calendarCells.length % 7);
  if (remaining < 7) {
    for (let i = 1; i <= remaining; i++) {
      const nextDate = new Date(year, month + 1, i);
      const nY = nextDate.getFullYear();
      const nM = String(nextDate.getMonth() + 1).padStart(2, '0');
      const nD = String(i).padStart(2, '0');
      const dateStr = `${nY}-${nM}-${nD}`;
      calendarCells.push({
        dateStr,
        dayNum: i,
        isCurrentMonth: false,
        isToday: dateStr === todayStr,
        count: activityData[dateStr] || 0,
      });
    }
  }

  return (
    <View style={styles.container}>
      {/* Month & Nav Header (Month left, Arrows far right) */}
      <View style={styles.header}>
        <Text style={styles.monthTitle}>
          {monthName} {year}
        </Text>
        <View style={styles.navGroup}>
          <TouchableOpacity
            style={[styles.navBtn, !canGoPrev && styles.navBtnDisabled]}
            onPress={handlePrevMonth}
            disabled={!canGoPrev}
            activeOpacity={0.6}
          >
            <Text style={[styles.navBtnText, !canGoPrev && styles.navBtnTextDisabled]}>‹</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.navBtn, !canGoNext && styles.navBtnDisabled]}
            onPress={handleNextMonth}
            disabled={!canGoNext}
            activeOpacity={0.6}
          >
            <Text style={[styles.navBtnText, !canGoNext && styles.navBtnTextDisabled]}>›</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Weekday Labels Header */}
      <View style={styles.weekdayRow}>
        {WEEKDAYS.map((day, idx) => (
          <Text key={idx} style={styles.weekdayText}>
            {day}
          </Text>
        ))}
      </View>

      {/* Monthly Grid */}
      <View style={styles.grid}>
        {calendarCells.map((cell, idx) => (
          <TouchableOpacity
            key={`${cell.dateStr}_${idx}`}
            style={styles.dayCell}
            onPress={() => {
              if (cell.count > 0) {
                onSelectDate(cell.dateStr, cell.count);
              }
            }}
            activeOpacity={cell.count > 0 ? 0.7 : 1}
          >
            <View style={[styles.dayNumWrapper, cell.isToday && styles.todayWrapper]}>
              <Text
                style={[
                  styles.dayNumText,
                  !cell.isCurrentMonth && styles.mutedDayText,
                  cell.isToday && styles.todayNumText,
                ]}
              >
                {cell.dayNum}
              </Text>
            </View>

            {/* Activity Indicator Dot */}
            <View style={styles.dotContainer}>
              {cell.count > 0 ? (
                <View style={styles.activityDot} />
              ) : (
                <View style={styles.emptyDotPlaceholder} />
              )}
            </View>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.xl,
    padding: 20,
    marginBottom: 24,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    marginBottom: 20,
    paddingHorizontal: 4,
  },
  monthTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.3,
  },
  navGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginLeft: 'auto',
  },
  navBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.border,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  navBtnDisabled: {
    opacity: 0.3,
  },
  navBtnText: {
    fontSize: 18,
    color: colors.text,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: Platform.OS === 'web' ? 30 : 20,
  },
  navBtnTextDisabled: {
    color: colors.textMuted,
  },
  weekdayRow: {
    flexDirection: 'row',
    width: '100%',
    marginBottom: 10,
  },
  weekdayText: {
    width: '14.28%',
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 8,
  },
  dayCell: {
    width: '14.28%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 2,
  },
  dayNumWrapper: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  todayWrapper: {
    backgroundColor: colors.primary,
  },
  dayNumText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
    lineHeight: Platform.OS === 'web' ? 32 : 20,
  },
  mutedDayText: {
    color: '#B0A89E',
  },
  todayNumText: {
    color: colors.surface,
    fontWeight: '700',
  },
  dotContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    marginTop: 2,
  },
  activityDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: colors.primary,
  },
  emptyDotPlaceholder: {
    width: 5,
    height: 5,
  },
});
