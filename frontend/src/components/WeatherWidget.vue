<script setup>
import { ref, computed, onMounted } from 'vue'
import LoadingSpinner from './LoadingSpinner.vue'

// Default to Los Angeles
const DEFAULT_LAT = 34.0522
const DEFAULT_LON = -118.2437
const DEFAULT_CITY = 'Los Angeles, California, United States'

const loading = ref(true)
const error = ref(null)
const weather = ref(null)
const userCity = ref(null)
const userLat = ref(null)
const userLon = ref(null)
const showCityInput = ref(false)
const cityInput = ref('')
const saving = ref(false)

// WMO Weather codes to descriptions and icons
const weatherCodes = {
  0: { desc: 'Clear sky', icon: '☀️' },
  1: { desc: 'Mainly clear', icon: '🌤️' },
  2: { desc: 'Partly cloudy', icon: '⛅' },
  3: { desc: 'Overcast', icon: '☁️' },
  45: { desc: 'Foggy', icon: '🌫️' },
  48: { desc: 'Depositing rime fog', icon: '🌫️' },
  51: { desc: 'Light drizzle', icon: '🌦️' },
  53: { desc: 'Moderate drizzle', icon: '🌦️' },
  55: { desc: 'Dense drizzle', icon: '🌧️' },
  56: { desc: 'Light freezing drizzle', icon: '🌨️' },
  57: { desc: 'Dense freezing drizzle', icon: '🌨️' },
  61: { desc: 'Slight rain', icon: '🌧️' },
  63: { desc: 'Moderate rain', icon: '🌧️' },
  65: { desc: 'Heavy rain', icon: '🌧️' },
  66: { desc: 'Light freezing rain', icon: '🌨️' },
  67: { desc: 'Heavy freezing rain', icon: '🌨️' },
  71: { desc: 'Slight snow', icon: '🌨️' },
  73: { desc: 'Moderate snow', icon: '❄️' },
  75: { desc: 'Heavy snow', icon: '❄️' },
  77: { desc: 'Snow grains', icon: '🌨️' },
  80: { desc: 'Slight rain showers', icon: '🌦️' },
  81: { desc: 'Moderate rain showers', icon: '🌧️' },
  82: { desc: 'Violent rain showers', icon: '⛈️' },
  85: { desc: 'Slight snow showers', icon: '🌨️' },
  86: { desc: 'Heavy snow showers', icon: '❄️' },
  95: { desc: 'Thunderstorm', icon: '⛈️' },
  96: { desc: 'Thunderstorm with hail', icon: '⛈️' },
  99: { desc: 'Thunderstorm with heavy hail', icon: '⛈️' }
}

const getWeatherInfo = (code) => {
  return weatherCodes[code] || { desc: 'Unknown', icon: '❓' }
}

const displayCity = computed(() => {
  if (userCity.value) {
    // Show just the city name, not the full path
    return userCity.value.split(',')[0]
  }
  return 'Los Angeles'
})

const fullCityName = computed(() => {
  return userCity.value || DEFAULT_CITY
})

// Fetch user profile for location
const fetchUserLocation = async () => {
  try {
    const response = await fetch('/api/profile', { credentials: 'include' })
    if (response.ok) {
      const data = await response.json()
      if (data.user.city && data.user.latitude && data.user.longitude) {
        userCity.value = data.user.city
        userLat.value = data.user.latitude
        userLon.value = data.user.longitude
      }
    }
  } catch (err) {
    console.error('Error fetching user location:', err)
  }
}

// Fetch weather from Open-Meteo
const fetchWeather = async () => {
  loading.value = true
  error.value = null

  const lat = userLat.value || DEFAULT_LAT
  const lon = userLon.value || DEFAULT_LON

  try {
    const response = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,apparent_temperature&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto`
    )

    if (!response.ok) {
      throw new Error('Failed to fetch weather')
    }

    const data = await response.json()
    weather.value = {
      temp: Math.round(data.current.temperature_2m),
      feelsLike: Math.round(data.current.apparent_temperature),
      humidity: data.current.relative_humidity_2m,
      windSpeed: Math.round(data.current.wind_speed_10m),
      windDirection: data.current.wind_direction_10m,
      code: data.current.weather_code
    }
  } catch (err) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}

// Save city
const saveCity = async () => {
  if (!cityInput.value.trim()) return

  saving.value = true
  try {
    const response = await fetch('/api/profile/location', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ city: cityInput.value })
    })

    if (response.ok) {
      const data = await response.json()
      userCity.value = data.city
      userLat.value = data.latitude
      userLon.value = data.longitude
      showCityInput.value = false
      cityInput.value = ''
      await fetchWeather()
    } else {
      const errData = await response.json()
      error.value = errData.message
    }
  } catch (err) {
    error.value = err.message
  } finally {
    saving.value = false
  }
}

// Get wind direction as compass
const windCompass = computed(() => {
  if (!weather.value) return ''
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  const index = Math.round(weather.value.windDirection / 45) % 8
  return directions[index]
})

onMounted(async () => {
  await fetchUserLocation()
  await fetchWeather()
})
</script>

<template>
  <div class="weather-widget">
    <!-- Loading state -->
    <div v-if="loading" class="loading-state">
      <LoadingSpinner size="small" class="weather-spinner" />
      <span>Loading weather...</span>
    </div>

    <!-- Error state -->
    <div v-else-if="error && !weather" class="error-state">
      <span class="error-icon">!</span>
      <p>{{ error }}</p>
      <button @click="fetchWeather">Retry</button>
    </div>

    <!-- Weather display -->
    <div v-else-if="weather" class="weather-content">
      <!-- Location header -->
      <div class="location-header">
        <span class="city-name" @click="showCityInput = !showCityInput" :title="fullCityName">
          {{ displayCity }}
        </span>
        <button class="edit-btn" @click="showCityInput = !showCityInput" title="Change location">
          ✎
        </button>
      </div>

      <!-- City input -->
      <div v-if="showCityInput" class="city-input-wrapper">
        <input
          v-model="cityInput"
          type="text"
          placeholder="Enter city name..."
          @keyup.enter="saveCity"
          :disabled="saving"
        />
        <button @click="saveCity" :disabled="saving || !cityInput.trim()">
          {{ saving ? '...' : 'Set' }}
        </button>
      </div>

      <!-- Main weather display -->
      <div class="main-weather">
        <span class="weather-icon">{{ getWeatherInfo(weather.code).icon }}</span>
        <div class="temp-section">
          <span class="temperature">{{ weather.temp }}°F</span>
          <span class="feels-like">Feels like {{ weather.feelsLike }}°</span>
        </div>
      </div>

      <div class="weather-desc">{{ getWeatherInfo(weather.code).desc }}</div>

      <!-- Weather details -->
      <div class="weather-details">
        <div class="detail-item">
          <span class="detail-icon">💧</span>
          <span class="detail-value">{{ weather.humidity }}%</span>
          <span class="detail-label">Humidity</span>
        </div>
        <div class="detail-item">
          <span class="detail-icon">💨</span>
          <span class="detail-value">{{ weather.windSpeed }} mph</span>
          <span class="detail-label">Wind {{ windCompass }}</span>
        </div>
      </div>

      <div v-if="error" class="inline-error">{{ error }}</div>
    </div>
  </div>
</template>

<style scoped>
.weather-widget {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 12px;
  background: linear-gradient(135deg, #00b4db 0%, #0083b0 100%);
  color: white;
  overflow-y: auto;
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 12px;
}

.weather-spinner {
  border-color: rgba(255, 255, 255, 0.3) !important;
  border-top-color: white !important;
}

.error-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 20px;
  text-align: center;
}

.error-icon {
  width: 32px;
  height: 32px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  margin-bottom: 8px;
}

.error-state button {
  margin-top: 12px;
  padding: 6px 16px;
  background: white;
  color: #0083b0;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.weather-content {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.location-header {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-bottom: 8px;
}

.city-name {
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  opacity: 0.9;
}

.city-name:hover {
  opacity: 1;
}

.edit-btn {
  background: none;
  border: none;
  color: white;
  font-size: 0.8rem;
  cursor: pointer;
  opacity: 0.7;
  padding: 2px;
}

.edit-btn:hover {
  opacity: 1;
}

.city-input-wrapper {
  display: flex;
  gap: 6px;
  margin-bottom: 10px;
}

.city-input-wrapper input {
  flex: 1;
  padding: 6px 10px;
  border: none;
  border-radius: 4px;
  font-size: 0.85rem;
}

.city-input-wrapper button {
  padding: 6px 12px;
  background: rgba(255, 255, 255, 0.2);
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.85rem;
}

.city-input-wrapper button:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.3);
}

.city-input-wrapper button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.main-weather {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-bottom: 4px;
}

.weather-icon {
  font-size: 3rem;
}

.temp-section {
  display: flex;
  flex-direction: column;
}

.temperature {
  font-size: 2.5rem;
  font-weight: 300;
  line-height: 1;
}

.feels-like {
  font-size: 0.75rem;
  opacity: 0.8;
}

.weather-desc {
  text-align: center;
  font-size: 0.9rem;
  margin-bottom: 12px;
  opacity: 0.9;
}

.weather-details {
  display: flex;
  justify-content: center;
  gap: 24px;
  background: rgba(255, 255, 255, 0.15);
  border-radius: var(--card-radius-sm);
  padding: 10px;
  margin-top: auto;
}

.detail-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.detail-icon {
  font-size: 1.2rem;
}

.detail-value {
  font-size: 0.9rem;
  font-weight: 600;
}

.detail-label {
  font-size: 0.7rem;
  opacity: 0.8;
}

.inline-error {
  text-align: center;
  font-size: 0.75rem;
  color: #ffcccc;
  margin-top: 8px;
}
</style>
