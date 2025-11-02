document.addEventListener('DOMContentLoaded', () => {
    // --- Registro del Service Worker para PWA ---
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./service-worker.js')
                .then(reg => {
                    console.log('✅ Service Worker Registrado:', reg.scope);
                    reg.onupdatefound = () => {
                        const installingWorker = reg.installing;
                        if (installingWorker) {
                            installingWorker.onstatechange = () => {
                                if (installingWorker.state === 'installed') {
                                    if (navigator.serviceWorker.controller) {
                                        console.log('🔄 Hay contenido nuevo disponible. Recarga la página.');
                                    } else {
                                        console.log('📦 Contenido cacheado para uso offline.');
                                    }
                                }
                            };
                        }
                    };
                })
                .catch(err => {
                    console.error('❌ Error al registrar Service Worker:', err);
                    alert('Error: No se pudo registrar el Service Worker para modo offline. La app funcionará, pero no sin conexión.');
                });
        });
    }

    // --- PWA Installation Prompt ---
    let deferredPrompt;
    const installBtn = document.createElement('button');
    installBtn.textContent = '📱 Instalar App';
    installBtn.className = 'install-btn';
    installBtn.style.display = 'none';

    const header = document.querySelector('header');
    if (header) {
        header.appendChild(installBtn);
    }

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        installBtn.style.display = 'block';
        console.log('👍 PWA installation prompt listo');
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

    // Límite de tamaño de archivo en MB (para prevenir crasheo en móvil)
    const MAX_FILE_SIZE_MB = 100;

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

        // Limpiar src anterior para detener la carga si hubiera una
        state.audio.src = '';
        state.audio.src = track.url;
        state.audio.load();

        trackTitle.textContent = track.name.replace(/\.[^/.]+$/, "");
        trackArtist.textContent = `${(track.size / 1024 / 1024).toFixed(2)} MB`;
        currentTrackName.textContent = track.name;

        updatePlaylistUI();

        // Si estaba sonando, intentar reproducir la nueva pista
        if (state.isPlaying) {
             // 'play()' devuelve una promesa que puede ser rechazada si el usuario no ha interactuado
            const playPromise = state.audio.play();
            if (playPromise !== undefined) {
                playPromise.catch(error => {
                    console.warn("Autoplay bloqueado, esperando interacción del usuario.", error);
                    // Si falla el autoplay, pausamos visualmente
                    playPauseUI(false);
                });
            }
        }
    }

    // Función separada para actualizar la UI (evita lógica duplicada)
    function playPauseUI(isPlaying) {
        state.isPlaying = isPlaying;
        if (isPlaying) {
            playPauseBtn.textContent = '⏸️';
            visualizer.classList.add('playing');
        } else {
            state.audio.pause();
            playPauseBtn.textContent = '▶️';
            visualizer.classList.remove('playing');
        }
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
            playPauseUI(false);
        } else {
            const playPromise = state.audio.play();
            if (playPromise !== undefined) {
                playPromise.then(() => {
                    playPauseUI(true);
                }).catch(error => {
                    console.error("Error al reproducir:", error);
                    playPauseUI(false);
                    alert("Error al reproducir. El archivo podría estar corrupto o no ser compatible.");
                });
            }
        }
    }

    function playNext() {
        if (state.playlist.length === 0) return;
        const nextIndex = (state.currentTrackIndex + 1) % state.playlist.length;
        loadTrack(nextIndex);
        // loadTrack ya se encarga de reproducir si state.isPlaying es true
    }

    function playPrev() {
        if (state.playlist.length === 0) return;
        const prevIndex = state.currentTrackIndex <= 0 ? state.playlist.length - 1 : state.currentTrackIndex - 1;
        loadTrack(prevIndex);
        // loadTrack ya se encarga de reproducir si state.isPlaying es true
    }

    async function handleFileUpload(files) {
        for (const file of files) {
            try {
                // --- PARCHE: LÍMITE DE TAMAÑO DE ARCHIVO ---
                if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
                    alert(`El archivo ${file.name} es demasiado grande (${(file.size / 1024 / 1024).toFixed(1)} MB). Límite: ${MAX_FILE_SIZE_MB} MB.`);
                    console.warn(`Archivo rechazado por tamaño: ${file.name}, ${file.size} bytes`);
                    continue; // Saltar este archivo
                }

                // --- PARCHE: VALIDACIÓN MÁS ROBUSTA Y CON MEJOR REGISTRO ---
                const validTypes = [
                    'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/wave',
                    'audio/ogg', 'audio/m4a', 'audio/mp4', 'audio/aac',
                    'audio/x-m4a', 'audio/flac', 'audio/webm'
                ];

                const fileName = file.name.toLowerCase();
                const fileExtension = fileName.split('.').pop();

                const isValidByType = validTypes.includes(file.type);
                const isValidByExtension = ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'webm'].includes(fileExtension);

                // --- LOG DE DEPURACIÓN CLAVE ---
                console.log(`[Validando Archivo] Nombre: ${file.name}, Tipo MIME: "${file.type}", Extensión: "${fileExtension}", VálidoPorTipo: ${isValidByType}, VálidoPorExt: ${isValidByExtension}`);

                // Si *ni* el tipo *ni* la extensión son válidos, rechazar.
                // Esto es más flexible para móviles donde file.type suele ser "".
                if (!isValidByType && !isValidByExtension) {
                    alert(`${file.name} no parece ser un archivo de audio válido (Extensión: ${fileExtension}, Tipo: ${file.type})`);
                    console.warn(`Archivo rechazado: ${file.name}. Tipo y extensión no válidos.`);
                    continue; // Saltar este archivo
                }
                // --- FIN DEL PARCHE DE VALIDACIÓN ---

                // Para dispositivos móviles, leer el archivo como Data URL
                const reader = new FileReader();
                reader.onload = function(e) {
                    const track = {
                        name: file.name,
                        url: e.target.result, // Usar Data URL
                        size: file.size,
                        type: file.type || `audio/${fileExtension}`
                    };

                    state.playlist.push(track);
                    updatePlaylistUI();
                    updateFileList();

                    if (state.currentTrackIndex === -1 && state.playlist.length > 0) {
                        loadTrack(0);
                    }
                };

                // --- PARCHE: MEJOR MANEJO DE ERROR DE FILEREADER ---
                reader.onerror = function(e) {
                    console.error(`Error de FileReader al leer el archivo ${file.name}:`, e);
                    alert(`Error al leer el archivo ${file.name}. ¿Quizás es demasiado grande o está corrupto?`);
                };

                reader.readAsDataURL(file);

            } catch (error) {
                console.error('Error al procesar el archivo:', error);
                alert(`Error al procesar el archivo ${file.name}: ${error.message}`);
            }
        }
    }

    function removeFromPlaylist(index) {
        // --- PARCHE: LIMPIEZA DE CÓDIGO ---
        // Ya no usamos Blob URLs (createObjectURL), usamos Data URLs.
        // Las Data URLs son strings y no necesitan ser "revocadas".
        // El recolector de basura las eliminará cuando se quite la referencia.
        // const track = state.playlist[index];
        // if (track.url && track.url.startsWith('blob:')) {
        //     URL.revokeObjectURL(track.url);
        // }

        state.playlist.splice(index, 1);

        if (state.currentTrackIndex === index) {
            // Si la pista eliminada era la actual
            if (state.isPlaying) {
                playPauseUI(false); // Detener la reproducción
            }
            state.audio.src = ''; // Limpiar el reproductor

            if (state.playlist.length > 0) {
                // Cargar la siguiente (o la que ahora esté en el mismo índice)
                loadTrack(Math.min(index, state.playlist.length - 1));
            } else {
                // La lista está vacía
                state.currentTrackIndex = -1;
                trackTitle.textContent = 'Selecciona un archivo de audio';
                trackArtist.textContent = 'Sube un archivo para comenzar';
                currentTrackName.textContent = 'Selecciona un sonido para comenzar';
                progressBar.value = 0;
                currentTimeEl.textContent = '0:00';
                durationEl.textContent = '0:00';
            }
        } else if (state.currentTrackIndex > index) {
            // Si se eliminó una pista *antes* de la actual, ajustar el índice
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
                    if (state.currentTrackIndex !== index) {
                        loadTrack(index);
                    } else if (!state.isPlaying) {
                        // Si se hace clic en la activa y está pausada, reproducir
                        playPause();
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

    uploadArea.addEventListener('drop', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        uploadArea.classList.remove('drag-over');

        const files = e.dataTransfer.files;
        if (files.length > 0) {
            console.log(`Procesando ${files.length} archivo(s) vía drag & drop`);
            await handleFileUpload(files);
        }
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

    // --- PARCHE: MEJOR MANEJO DE ERROR DE AUDIO ---
    state.audio.addEventListener('error', (e) => {
        console.error('Error al cargar el audio:', e);
        const error = state.audio.error;
        // Obtener el nombre de la pista que falló
        const trackName = state.playlist[state.currentTrackIndex]?.name || 'el archivo de audio';
        let errorMessage = `Error desconocido al cargar ${trackName}`;

        switch(error?.code) {
            case 1: // MEDIA_ERR_ABORTED
                errorMessage = `La carga de ${trackName} fue abortada.`;
                break;
            case 2: // MEDIA_ERR_NETWORK
                errorMessage = `Error de red al cargar ${trackName}.`;
                break;
            case 3: // MEDIA_ERR_DECODE
                errorMessage = `Error al decodificar ${trackName}. El archivo puede estar corrupto.`;
                break;
            case 4: // MEDIA_ERR_SRC_NOT_SUPPORTED
                errorMessage = `El formato de ${trackName} no es compatible con tu navegador.`;
                break;
        }

        console.error(errorMessage);
        alert(errorMessage); // Mostrar el error específico al usuario

        // Intentar reproducir el siguiente para no detener la playlist
        setTimeout(() => playNext(), 1000);
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
        if (isNaN(minutes) || minutes <= 0) {
            alert("Por favor, introduce un número válido de minutos.");
            return;
        }

        state.timerSeconds = minutes * 60;
        updateTimerDisplay();

        state.timerInterval = setInterval(() => {
            state.timerSeconds--;
            updateTimerDisplay();

            if (state.timerSeconds <= 0) {
                clearInterval(state.timerInterval);
                timerDisplay.textContent = '¡Tiempo!';
                if (state.isPlaying) {
                    playPause(); // Pausa la música
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

    audioFileInput.addEventListener('change', async (e) => {
        const files = e.target.files;
        if (files.length > 0) {
            console.log(`Procesando ${files.length} archivo(s) de audio`);
            await handleFileUpload(files);
            e.target.value = '';
        }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Evitar que los atajos se activen si se está escribiendo en el input del timer
        if (e.target === timerInput) return;

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

    // Detectar si es un dispositivo móvil
    function isMobile() {
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    }

    // Mejoras específicas para móvil
    if (isMobile()) {
        console.log('Dispositivo móvil detectado - aplicando optimizaciones');

        // Prevenir zoom al tocar controles (mejora de usabilidad)
        document.addEventListener('touchstart', (e) => {
            if (e.target.matches('button, input[type="range"], .playlist-track')) {
                // No previene el default completamente para permitir 'click'
            }
        }, { passive: true });

        // Agregar retroalimentación táctil simple
        document.querySelectorAll('button, .playlist-track').forEach(btn => {
            btn.addEventListener('touchstart', () => {
                btn.style.opacity = '0.7';
            }, { passive: true });
            btn.addEventListener('touchend', () => {
                setTimeout(() => {
                    btn.style.opacity = '';
                }, 100);
            }, { passive: true });
        });
    }

    // Initialize UI
    updatePlaylistUI();

    // Mensaje de bienvenida con instrucciones
    if (state.playlist.length === 0) {
        const instructions = isMobile()
            ? '📱 Para cargar audio: Toca el área de subida y selecciona tus archivos de música'
            : '💻 Para cargar audio: Haz clic o arrastra archivos de música al área de subida';

        console.log(instructions);
    }
});