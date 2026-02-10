<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'

const currentTime = ref(new Date())
const userTimezone = ref(null)
const showTimezoneSelector = ref(false)
const saving = ref(false)
let timer = null

// Common timezones for selection
const commonTimezones = [
  { value: 'America/New_York', label: 'Eastern Time (New York)' },
  { value: 'America/Chicago', label: 'Central Time (Chicago)' },
  { value: 'America/Denver', label: 'Mountain Time (Denver)' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (Los Angeles)' },
  { value: 'America/Anchorage', label: 'Alaska Time' },
  { value: 'Pacific/Honolulu', label: 'Hawaii Time' },
  { value: 'America/Phoenix', label: 'Arizona (No DST)' },
  { value: 'America/Toronto', label: 'Toronto' },
  { value: 'America/Vancouver', label: 'Vancouver' },
  { value: 'America/Mexico_City', label: 'Mexico City' },
  { value: 'America/Sao_Paulo', label: 'Sao Paulo' },
  { value: 'Europe/London', label: 'London (GMT/BST)' },
  { value: 'Europe/Paris', label: 'Paris (CET)' },
  { value: 'Europe/Berlin', label: 'Berlin (CET)' },
  { value: 'Europe/Moscow', label: 'Moscow' },
  { value: 'Asia/Dubai', label: 'Dubai' },
  { value: 'Asia/Kolkata', label: 'India (IST)' },
  { value: 'Asia/Singapore', label: 'Singapore' },
  { value: 'Asia/Shanghai', label: 'China (CST)' },
  { value: 'Asia/Tokyo', label: 'Tokyo (JST)' },
  { value: 'Asia/Seoul', label: 'Seoul (KST)' },
  { value: 'Australia/Sydney', label: 'Sydney (AEST)' },
  { value: 'Australia/Perth', label: 'Perth (AWST)' },
  { value: 'Pacific/Auckland', label: 'Auckland (NZST)' },
  { value: 'UTC', label: 'UTC' }
]

// Get effective timezone (user's saved or detected)
const effectiveTimezone = computed(() => {
  return userTimezone.value || Intl.DateTimeFormat().resolvedOptions().timeZone
})

// Format current time
const formattedTime = computed(() => {
  return currentTime.value.toLocaleTimeString('en-US', {
    timeZone: effectiveTimezone.value,
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  })
})

// Format current date
const formattedDate = computed(() => {
  return currentTime.value.toLocaleDateString('en-US', {
    timeZone: effectiveTimezone.value,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
})

// Get timezone abbreviation
const timezoneAbbr = computed(() => {
  const parts = currentTime.value.toLocaleTimeString('en-US', {
    timeZone: effectiveTimezone.value,
    timeZoneName: 'short'
  }).split(' ')
  return parts[parts.length - 1]
})

// Calendar data
const calendarData = computed(() => {
  const now = new Date(currentTime.value.toLocaleString('en-US', { timeZone: effectiveTimezone.value }))
  const year = now.getFullYear()
  const month = now.getMonth()
  const today = now.getDate()

  // First day of month
  const firstDay = new Date(year, month, 1)
  const startDay = firstDay.getDay()

  // Days in month
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  // Days from previous month to show
  const prevMonthDays = new Date(year, month, 0).getDate()

  const weeks = []
  let day = 1
  let nextMonthDay = 1

  for (let week = 0; week < 6; week++) {
    const days = []
    for (let d = 0; d < 7; d++) {
      if (week === 0 && d < startDay) {
        // Previous month
        days.push({
          day: prevMonthDays - startDay + d + 1,
          current: false,
          today: false
        })
      } else if (day > daysInMonth) {
        // Next month
        days.push({
          day: nextMonthDay++,
          current: false,
          today: false
        })
      } else {
        // Current month
        days.push({
          day: day,
          current: true,
          today: day === today
        })
        day++
      }
    }
    weeks.push(days)
    if (day > daysInMonth && week >= 4) break
  }

  return {
    monthName: firstDay.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    weeks
  }
})

// Fetch user's saved timezone
const fetchTimezone = async () => {
  try {
    const response = await fetch('/api/profile', { credentials: 'include' })
    if (response.ok) {
      const data = await response.json()
      if (data.user.timezone) {
        userTimezone.value = data.user.timezone
      }
    }
  } catch (err) {
    console.error('Error fetching timezone:', err)
  }
}

// Save timezone
const saveTimezone = async (tz) => {
  saving.value = true
  try {
    const response = await fetch('/api/profile/timezone', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ timezone: tz })
    })

    if (response.ok) {
      userTimezone.value = tz
      showTimezoneSelector.value = false
    }
  } catch (err) {
    console.error('Error saving timezone:', err)
  } finally {
    saving.value = false
  }
}

// Auto-detect and save timezone if not set
const autoDetectTimezone = async () => {
  if (!userTimezone.value) {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone
    await saveTimezone(detected)
  }
}

onMounted(() => {
  fetchTimezone().then(() => {
    autoDetectTimezone()
  })

  // Update time every second
  timer = setInterval(() => {
    currentTime.value = new Date()
  }, 1000)
})

onUnmounted(() => {
  if (timer) {
    clearInterval(timer)
  }
})
</script>

<template>
  <div class="calendar-widget">
    <!-- Time Display -->
    <div class="time-section">
      <div class="time-display">{{ formattedTime }}</div>
      <div class="date-display">{{ formattedDate }}</div>
      <button class="timezone-btn" @click="showTimezoneSelector = !showTimezoneSelector">
        {{ timezoneAbbr }}
      </button>
    </div>

    <!-- Timezone Selector -->
    <div v-if="showTimezoneSelector" class="timezone-selector">
      <select
        :value="effectiveTimezone"
        @change="saveTimezone($event.target.value)"
        :disabled="saving"
      >
        <option v-for="tz in commonTimezones" :key="tz.value" :value="tz.value">
          {{ tz.label }}
        </option>
      </select>
    </div>

    <!-- Calendar -->
    <div class="calendar-section">
      <div class="calendar-header">{{ calendarData.monthName }}</div>
      <div class="calendar-grid">
        <div class="weekday-header">
          <span>Su</span>
          <span>Mo</span>
          <span>Tu</span>
          <span>We</span>
          <span>Th</span>
          <span>Fr</span>
          <span>Sa</span>
        </div>
        <div v-for="(week, i) in calendarData.weeks" :key="i" class="week-row">
          <span
            v-for="(day, j) in week"
            :key="j"
            class="day-cell"
            :class="{
              'other-month': !day.current,
              'today': day.today
            }"
          >
            {{ day.day }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.calendar-widget {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 8px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  overflow: hidden;
  gap: 6px;
}

.time-section {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 2px;
  position: relative;
  flex-shrink: 0;
  padding: 4px 0;
}

.time-display {
  font-size: 1.4rem;
  font-weight: 300;
  letter-spacing: 0.5px;
  line-height: 1.2;
}

.date-display {
  font-size: 0.65rem;
  opacity: 0.9;
  text-align: center;
}

.timezone-btn {
  background: rgba(255, 255, 255, 0.2);
  border: none;
  color: white;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 0.55rem;
  cursor: pointer;
  transition: background 0.2s;
  margin-top: 2px;
}

.timezone-btn:hover {
  background: rgba(255, 255, 255, 0.3);
}

.timezone-selector {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  z-index: 10;
  margin-top: 4px;
}

.timezone-selector select {
  width: 100%;
  padding: 4px;
  border: none;
  border-radius: 4px;
  font-size: 0.7rem;
  background: rgba(255, 255, 255, 0.95);
  color: #333;
}

.calendar-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: rgba(255, 255, 255, 0.15);
  border-radius: var(--card-radius-sm);
  padding: 4px 6px;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.calendar-header {
  text-align: center;
  font-weight: 600;
  font-size: 0.7rem;
  margin-bottom: 4px;
  padding-bottom: 3px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.2);
}

.calendar-grid {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: space-around;
}

.weekday-header {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  text-align: center;
  font-size: 0.55rem;
  font-weight: 600;
  opacity: 0.8;
}

.week-row {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  text-align: center;
}

.day-cell {
  font-size: 0.6rem;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  padding: 2px;
}

.day-cell.other-month {
  opacity: 0.4;
}

.day-cell.today {
  background: white;
  color: #764ba2;
  font-weight: 700;
}
</style>
