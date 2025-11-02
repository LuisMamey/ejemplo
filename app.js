document.addEventListener('DOMContentLoaded', () => {
    // --- Registro del Service Worker para PWA ---
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/service-worker.js')
            .then(reg => console.log('Service Worker registrado:', reg))
            .catch(err => console.error('Error al registrar Service Worker:', err));
    }

    // --- PWA Installation Prompt ---
    let deferredPrompt;
    const installBtn = document.createElement('button');
    installBtn.textContent = '📱 Instalar App';
    installBtn.className = 'install-btn';
    installBtn.style.display = 'none';

    // Agregar botón de instalación al header
    const header = document.querySelector('header');
    if (header) {
        header.appendChild(installBtn);
    }

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        installBtn.style.display = 'block';
        console.log('PWA installation prompt ready');
    });

    installBtn.addEventListener('click', async () => {
        if (!deferredPrompt) return;

        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        console.log(`User response to installation prompt: ${outcome}`);

        deferredPrompt = null;
        installBtn.style.display = 'none';
    });

    // --- Estado de la Aplicación ---
    const state = {
        playlist: [],
        currentTrackIndex: -1,
        isPlaying: false,
        audio: new Audio(),
        timerInterval: null,
        timerSeconds: 0,
    };

    // --- Referencias a Elementos del DOM ---
    const playPauseBtn = document.getElementById('play-pause-btn');
    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    const trackTitle = document.getElementById('track-title');
    const trackArtist = document.getElementById('track-artist');
    const currentTimeEl = document.getElementById('current-time');
    const durationEl = document.getElementById('duration');
    const progressBar = document.getElementById('progress-bar');
    const currentTrackName = document.getElementById('current-track-name');
    const visualizer = document.getElementById('visualizer');
    const visualizerText = document.getElementById('visualizer-text');
    const timerInput = document.getElementById('timer-input');
    const startTimerBtn = document.getElementById('start-timer-btn');
    const timerDisplay = document.getElementById('timer-display');
    const audioFileInput = document.getElementById('audio-file-input');
    const uploadArea = document.getElementById('upload-area');
    const fileList = document.getElementById('file-list');
    const playlistTracks = document.getElementById('playlist-tracks');

    // --- Funciones Principales ---

    function formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    function loadTrack(index) {
        if (index < 0 || index >= state.playlist.length) return;

        state.currentTrackIndex = index;
        const track = state.playlist[index];

        state.audio.src = track.url;
        state.audio.load();

        trackTitle.textContent = track.name.replace(/\.[^/.]+$/, "");
        trackArtist.textContent = `${(track.size / 1024 / 1024).toFixed(2)} MB`;
        currentTrackName.textContent = track.name;

        updatePlaylistUI();
    }

    function playPause() {
        if (state.playlist.length === 0) {
            alert('Por favor, sube archivos de audio primero');
            return;
        }

        if (state.currentTrackIndex === -1) {
            loadTrack(0);
        }

        if (state.isPlaying) {
            state.audio.pause();
            playPauseBtn.textContent = '▶️';
            visualizer.classList.remove('playing');
        } else {
            state.audio.play();
            playPauseBtn.textContent = '⏸️';
            visualizer.classList.add('playing');
        }
        state.isPlaying = !state.isPlaying;
    }

    function playNext() {
        if (state.playlist.length === 0) return;
        const nextIndex = (state.currentTrackIndex + 1) % state.playlist.length;
        loadTrack(nextIndex);
        if (state.isPlaying) {
            state.audio.play();
        }
    }

    function playPrev() {
        if (state.playlist.length === 0) return;
        const prevIndex = state.currentTrackIndex <= 0 ? state.playlist.length - 1 : state.currentTrackIndex - 1;
        loadTrack(prevIndex);
        if (state.isPlaying) {
            state.audio.play();
        }
    }

    function handleFileUpload(files) {
        Array.from(files).forEach(file => {
            if (!file.type.startsWith('audio/')) {
                alert(`${file.name} no es un archivo de audio válido`);
                return;
            }

            const url = URL.createObjectURL(file);
            const track = {
                name: file.name,
                url: url,
                size: file.size,
                type: file.type
            };

            state.playlist.push(track);
        });

        updatePlaylistUI();
        updateFileList();

        if (state.currentTrackIndex === -1 && state.playlist.length > 0) {
            loadTrack(0);
        }
    }

    function removeFromPlaylist(index) {
        const track = state.playlist[index];
        URL.revokeObjectURL(track.url);

        state.playlist.splice(index, 1);

        if (state.currentTrackIndex === index) {
            if (state.playlist.length > 0) {
                loadTrack(Math.min(index, state.playlist.length - 1));
            } else {
                state.currentTrackIndex = -1;
                state.audio.src = '';
                trackTitle.textContent = 'Selecciona un archivo de audio';
                trackArtist.textContent = 'Sube un archivo para comenzar';
                currentTrackName.textContent = 'Selecciona un sonido para comenzar';
            }
        } else if (state.currentTrackIndex > index) {
            state.currentTrackIndex--;
        }

        updatePlaylistUI();
        updateFileList();
    }

    function updatePlaylistUI() {
        if (state.playlist.length === 0) {
            playlistTracks.innerHTML = '<p class="empty-message">No hay archivos cargados</p>';
            return;
        }

        playlistTracks.innerHTML = state.playlist.map((track, index) => `
            <div class="playlist-track ${index === state.currentTrackIndex ? 'active' : ''}" data-index="${index}">
                <div class="playlist-track-info">
                    <div class="playlist-track-title">${track.name.replace(/\.[^/.]+$/, "")}</div>
                    <div class="playlist-track-duration">${(track.size / 1024 / 1024).toFixed(2)} MB</div>
                </div>
                <button class="playlist-track-remove" data-index="${index}">✕</button>
            </div>
        `).join('');

        // Add event listeners to playlist tracks
        document.querySelectorAll('.playlist-track').forEach(trackEl => {
            const index = parseInt(trackEl.dataset.index);
            trackEl.addEventListener('click', (e) => {
                if (!e.target.classList.contains('playlist-track-remove')) {
                    loadTrack(index);
                    if (state.isPlaying) {
                        state.audio.play();
                    }
                }
            });
        });

        // Add event listeners to remove buttons
        document.querySelectorAll('.playlist-track-remove').forEach(btn => {
            const index = parseInt(btn.dataset.index);
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                removeFromPlaylist(index);
            });
        });
    }

    function updateFileList() {
        if (state.playlist.length === 0) {
            fileList.innerHTML = '';
            return;
        }

        fileList.innerHTML = state.playlist.map((track, index) => `
            <div class="file-item">
                <span class="file-name">${track.name}</span>
                <button class="remove-file" data-index="${index}">Eliminar</button>
            </div>
        `).join('');

        // Add event listeners to remove buttons
        document.querySelectorAll('.remove-file').forEach(btn => {
            const index = parseInt(btn.dataset.index);
            btn.addEventListener('click', () => removeFromPlaylist(index));
        });
    }

    // --- Drag and Drop ---
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        uploadArea.addEventListener(eventName, preventDefaults, false);
        document.body.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    ['dragenter', 'dragover'].forEach(eventName => {
        uploadArea.addEventListener(eventName, () => {
            uploadArea.classList.add('drag-over');
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        uploadArea.addEventListener(eventName, () => {
            uploadArea.classList.remove('drag-over');
        }, false);
    });

    uploadArea.addEventListener('drop', (e) => {
        const files = e.dataTransfer.files;
        handleFileUpload(files);
    }, false);

    // --- Audio Event Listeners ---
    state.audio.addEventListener('timeupdate', () => {
        if (state.audio.duration) {
            const progress = (state.audio.currentTime / state.audio.duration) * 100;
            progressBar.value = progress;
            currentTimeEl.textContent = formatTime(state.audio.currentTime);
            durationEl.textContent = formatTime(state.audio.duration);
        }
    });

    state.audio.addEventListener('ended', () => {
        playNext();
    });

    state.audio.addEventListener('loadedmetadata', () => {
        durationEl.textContent = formatTime(state.audio.duration);
    });

    // --- Progress Bar Control ---
    progressBar.addEventListener('input', (e) => {
        if (state.audio.duration) {
            const time = (e.target.value / 100) * state.audio.duration;
            state.audio.currentTime = time;
        }
    });

    // --- Timer Functions ---
    function startTimer() {
        clearInterval(state.timerInterval);
        const minutes = parseInt(timerInput.value, 10);
        if (isNaN(minutes) || minutes <= 0) return;

        state.timerSeconds = minutes * 60;
        updateTimerDisplay();

        state.timerInterval = setInterval(() => {
            state.timerSeconds--;
            updateTimerDisplay();

            if (state.timerSeconds <= 0) {
                clearInterval(state.timerInterval);
                timerDisplay.textContent = '¡Tiempo!';
                if (state.isPlaying) {
                    playPause();
                }
            }
        }, 1000);
    }

    function updateTimerDisplay() {
        const minutes = Math.floor(state.timerSeconds / 60);
        const seconds = state.timerSeconds % 60;
        timerDisplay.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }

    // --- Event Listeners ---
    playPauseBtn.addEventListener('click', playPause);
    prevBtn.addEventListener('click', playPrev);
    nextBtn.addEventListener('click', playNext);
    startTimerBtn.addEventListener('click', startTimer);

    audioFileInput.addEventListener('change', (e) => {
        handleFileUpload(e.target.files);
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        switch(e.code) {
            case 'Space':
                e.preventDefault();
                playPause();
                break;
            case 'ArrowLeft':
                if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    playPrev();
                }
                break;
            case 'ArrowRight':
                if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    playNext();
                }
                break;
        }
    });

    // Initialize UI
    updatePlaylistUI();
});