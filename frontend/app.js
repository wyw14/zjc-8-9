const { createApp, ref, onMounted, onUnmounted, computed, nextTick, watch } = Vue;

const API_BASE = 'http://localhost:3109/api';

createApp({
  setup() {
    const isLoggedIn = ref(false);
    const user = ref(null);
    const token = ref(null);

    const loginForm = ref({ username: '', password: '' });
    const loginLoading = ref(false);
    const loginError = ref('');

    const dreams = ref([]);
    const randomDream = ref(null);
    const monthlyStats = ref({ count: 0, avgLucidity: 0 });
    const trendMaxDream = ref(null);
    const trendMinDream = ref(null);
    const trendChartRef = ref(null);
    let trendChartInstance = null;

    const now = new Date();
    const selectedYear = ref(now.getFullYear());
    const selectedMonth = ref(now.getMonth() + 1);
    const yearOptions = computed(() => {
      const current = new Date().getFullYear();
      const years = [];
      for (let y = current - 5; y <= current; y++) {
        years.push(y);
      }
      return years;
    });

    const newDream = ref({
      content: '',
      lucidity: 3,
      date: new Date().toISOString().split('T')[0]
    });

    const isPlaying = ref(false);
    let audioContext = null;
    let noiseNode = null;
    let gainNode = null;
    let currentTrendData = null;
    let resizeTimeout = null;

    function getToken() {
      return localStorage.getItem('dream_token');
    }

    function saveToken(t) {
      localStorage.setItem('dream_token', t);
      token.value = t;
    }

    function clearToken() {
      localStorage.removeItem('dream_token');
      token.value = null;
    }

    function saveUser(u) {
      localStorage.setItem('dream_user', JSON.stringify(u));
      user.value = u;
    }

    function loadUser() {
      const saved = localStorage.getItem('dream_user');
      if (saved) {
        user.value = JSON.parse(saved);
        isLoggedIn.value = true;
      }
    }

    async function apiRequest(url, options = {}) {
      const headers = { 'Content-Type': 'application/json', ...options.headers };
      const t = getToken();
      if (t) {
        headers['Authorization'] = `Bearer ${t}`;
      }

      const response = await fetch(`${API_BASE}${url}`, {
        ...options,
        headers
      });

      if (response.status === 401 || response.status === 403) {
        clearToken();
        isLoggedIn.value = false;
        user.value = null;
        throw new Error('未登录');
      }

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || '请求失败');
      }
      return data;
    }

    async function handleLogin() {
      if (!loginForm.value.username || !loginForm.value.password) {
        loginError.value = '请输入用户名和密码';
        return;
      }

      loginLoading.value = true;
      loginError.value = '';

      try {
        const data = await apiRequest('/login', {
          method: 'POST',
          body: JSON.stringify(loginForm.value)
        });

        saveToken(data.token);
        saveUser(data.user);
        isLoggedIn.value = true;
        loadData();
      } catch (e) {
        loginError.value = e.message;
      } finally {
        loginLoading.value = false;
      }
    }

    function handleLogout() {
      clearToken();
      stopWhiteNoise();
      isLoggedIn.value = false;
      user.value = null;
      dreams.value = [];
      randomDream.value = null;
    }

    async function fetchDreams() {
      try {
        const data = await apiRequest('/dreams');
        dreams.value = data;
      } catch (e) {
        console.error('获取梦境列表失败', e);
      }
    }

    async function fetchRandomDream() {
      try {
        const data = await apiRequest('/dreams/random');
        randomDream.value = data;
        if (!isPlaying.value) {
          startWhiteNoise();
          setTimeout(() => {
            stopWhiteNoise();
          }, 12000);
        }
      } catch (e) {
        alert(e.message);
      }
    }

    async function fetchMonthlyStats() {
      try {
        const data = await apiRequest('/stats/monthly?year=' + selectedYear.value + '&month=' + selectedMonth.value);
        monthlyStats.value = data;
      } catch (e) {
        console.error('获取月度统计失败', e);
      }
    }

    async function fetchLucidityTrend() {
      try {
        const data = await apiRequest('/stats/lucidity-trend');
        trendMaxDream.value = data.maxDream;
        trendMinDream.value = data.minDream;
        currentTrendData = data.trendData;
        await nextTick();
        renderTrendChart(data.trendData);
      } catch (e) {
        console.error('获取清醒度趋势失败', e);
      }
    }

    function handleResize() {
      if (resizeTimeout) {
        clearTimeout(resizeTimeout);
      }
      resizeTimeout = setTimeout(() => {
        if (currentTrendData && isLoggedIn.value) {
          renderTrendChart(currentTrendData);
        }
      }, 200);
    }

    function renderTrendChart(trendData) {
      const canvas = trendChartRef.value;
      if (!canvas) return;

      const ctx = canvas.getContext('2d');
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);

      const width = rect.width;
      const height = rect.height;
      const padding = { top: 20, right: 20, bottom: 50, left: 40 };
      const chartWidth = width - padding.left - padding.right;
      const chartHeight = height - padding.top - padding.bottom;

      ctx.clearRect(0, 0, width, height);

      const validPoints = trendData.filter(d => d.avgLucidity !== null);
      if (validPoints.length === 0) {
        ctx.fillStyle = '#64748b';
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('最近30天暂无梦境记录', width / 2, height / 2);
        return;
      }

      const yMax = 5;
      const yMin = 0;
      const yStep = 1;

      ctx.strokeStyle = 'rgba(107, 114, 128, 0.2)';
      ctx.lineWidth = 1;
      ctx.fillStyle = '#6b7280';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';

      const ySteps = (yMax - yMin) / yStep;
      for (let i = 0; i <= ySteps; i++) {
        const y = padding.top + (i / ySteps) * chartHeight;
        const value = yMax - i * yStep;
        
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(width - padding.right, y);
        ctx.stroke();
        
        ctx.fillText(value.toString(), padding.left - 10, y);
      }

      const labels = trendData.map(d => {
        const date = new Date(d.date);
        return (date.getMonth() + 1) + '/' + date.getDate();
      });

      const xStep = chartWidth / (trendData.length - 1);
      
      ctx.fillStyle = '#6b7280';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';

      const labelStep = Math.ceil(trendData.length / 10);
      for (let i = 0; i < trendData.length; i += labelStep) {
        const x = padding.left + i * xStep;
        ctx.save();
        ctx.translate(x, height - padding.bottom + 8);
        ctx.rotate(-Math.PI / 4);
        ctx.fillText(labels[i], 0, 0);
        ctx.restore();
      }

      const points = trendData.map((d, i) => ({
        x: padding.left + i * xStep,
        y: d.avgLucidity !== null 
          ? padding.top + ((yMax - d.avgLucidity) / (yMax - yMin)) * chartHeight
          : null,
        value: d.avgLucidity,
        date: d.date,
        count: d.count
      }));

      const gradient = ctx.createLinearGradient(0, padding.top, 0, height - padding.bottom);
      gradient.addColorStop(0, 'rgba(139, 92, 246, 0.3)');
      gradient.addColorStop(1, 'rgba(139, 92, 246, 0.02)');

      ctx.beginPath();
      let started = false;
      for (let i = 0; i < points.length; i++) {
        if (points[i].y !== null) {
          if (!started) {
            ctx.moveTo(points[i].x, height - padding.bottom);
            ctx.lineTo(points[i].x, points[i].y);
            started = true;
          } else {
            const prev = points[i - 1];
            if (prev.y !== null) {
              const cpx = (prev.x + points[i].x) / 2;
              ctx.bezierCurveTo(cpx, prev.y, cpx, points[i].y, points[i].x, points[i].y);
            } else {
              ctx.lineTo(points[i].x, points[i].y);
            }
          }
        }
      }
      if (started) {
        const lastValid = [...points].reverse().find(p => p.y !== null);
        if (lastValid) {
          ctx.lineTo(lastValid.x, height - padding.bottom);
        }
        ctx.closePath();
        ctx.fillStyle = gradient;
        ctx.fill();
      }

      ctx.beginPath();
      ctx.strokeStyle = '#8b5cf6';
      ctx.lineWidth = 2.5;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      started = false;
      for (let i = 0; i < points.length; i++) {
        if (points[i].y !== null) {
          if (!started) {
            ctx.moveTo(points[i].x, points[i].y);
            started = true;
          } else {
            const prev = points[i - 1];
            if (prev.y !== null) {
              const cpx = (prev.x + points[i].x) / 2;
              ctx.bezierCurveTo(cpx, prev.y, cpx, points[i].y, points[i].x, points[i].y);
            } else {
              ctx.moveTo(points[i].x, points[i].y);
            }
          }
        }
      }
      ctx.stroke();

      points.forEach(p => {
        if (p.y !== null) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
          ctx.fillStyle = '#8b5cf6';
          ctx.fill();
          ctx.beginPath();
          ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
          ctx.fillStyle = '#fff';
          ctx.fill();
        }
      });

      trendChartInstance = { canvas, points };
    }

    function onMonthChange() {
      fetchMonthlyStats();
    }

    async function addDream() {
      if (!newDream.value.content.trim()) {
        alert('请输入梦境内容');
        return;
      }

      try {
        await apiRequest('/dreams', {
          method: 'POST',
          body: JSON.stringify(newDream.value)
        });

        newDream.value = {
          content: '',
          lucidity: 3,
          date: new Date().toISOString().split('T')[0]
        };

        loadData();
      } catch (e) {
        alert(e.message);
      }
    }

    function loadData() {
      fetchDreams();
      fetchMonthlyStats();
      fetchLucidityTrend();
    }

    function createWhiteNoise() {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      audioContext = new AudioContext();

      const bufferSize = 2 * audioContext.sampleRate;
      const noiseBuffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
      const output = noiseBuffer.getChannelData(0);

      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }

      noiseNode = audioContext.createBufferSource();
      noiseNode.buffer = noiseBuffer;
      noiseNode.loop = true;

      gainNode = audioContext.createGain();
      gainNode.gain.value = 0.05;

      const filter = audioContext.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1000;

      noiseNode.connect(filter);
      filter.connect(gainNode);
      gainNode.connect(audioContext.destination);

      noiseNode.start();
    }

    function toggleWhiteNoise() {
      if (isPlaying.value) {
        stopWhiteNoise();
      } else {
        startWhiteNoise();
      }
    }

    function startWhiteNoise() {
      if (!audioContext) {
        createWhiteNoise();
      } else if (audioContext.state === 'suspended') {
        audioContext.resume();
      }
      if (gainNode) {
        gainNode.gain.setValueAtTime(0.05, audioContext.currentTime);
      }
      isPlaying.value = true;
    }

    function stopWhiteNoise() {
      if (gainNode && audioContext) {
        gainNode.gain.setValueAtTime(0, audioContext.currentTime);
      }
      isPlaying.value = false;
    }

    onMounted(() => {
      loadUser();
      if (isLoggedIn.value) {
        loadData();
      }
      window.addEventListener('resize', handleResize);
    });

    onUnmounted(() => {
      window.removeEventListener('resize', handleResize);
      if (resizeTimeout) {
        clearTimeout(resizeTimeout);
      }
    });

    return {
      isLoggedIn,
      user,
      loginForm,
      loginLoading,
      loginError,
      handleLogin,
      handleLogout,
      dreams,
      randomDream,
      monthlyStats,
      trendMaxDream,
      trendMinDream,
      trendChartRef,
      newDream,
      fetchRandomDream,
      addDream,
      isPlaying,
      toggleWhiteNoise,
      selectedYear,
      selectedMonth,
      yearOptions,
      onMonthChange
    };
  }
}).mount('#app');
