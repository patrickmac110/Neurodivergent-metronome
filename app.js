
        const App = (() => {
            let state = { bpm: 120, beatsPerMeasure: 4, soundParams: { cow: { name: "Cow 🐮", emoji: "🐮", freq: 110, dur: 0.20, fadeIn: 0.01, fadeOut: 0.18, type: 'sawtooth', vol: 0.6 }, tiger: { name: "Tiger 🐯", emoji: "🐯", freq: 400, dur: 0.15, fadeIn: 0.005, fadeOut: 0.12, type: 'square', vol: 0.4 }, pig: { name: "Pig 🐷", emoji: "🐷", freq: 880, dur: 0.08, fadeIn: 0.002, fadeOut: 0.07, type: 'triangle', vol: 0.35 }, frog: { name: "Frog 🐸", emoji: "🐸", freq: 1400, dur: 0.06, fadeIn: 0.001, fadeOut: 0.05, type: 'sine', vol: 0.3 }, up: { name: "Up ↑", emoji: "↑", freq: 750, dur: 0.05, fadeIn: 0.001, fadeOut: 0.04, type: 'sine', vol: 0.35 }, down: { name: "Down ↓", emoji: "↓", freq: 500, dur: 0.07, fadeIn: 0.001, fadeOut: 0.06, type: 'sine', vol: 0.4 } }, patternConfig: [], isRunning: false, current16thNote: 0, nextNoteTime: 0.0, patternEditMode: 'animal', activeStepElement: null, c5: '#8b5cf6', c6: '#64748b', displayMode: 'symbol' };
            const MAX_BEATS = 8; const MAX_EXPORT_DURATION_SEC = 300; const MIN_BPM = 1; const MAX_BPM = 300;
            let audioContext; let timerID = null; let dom = {};
            let masterGain, animationID, visualQueue = [], activeVoices = new Set(), generation = 0;
            let countRemaining = 0, starting = false, wakeLock = null;
            const preferences = {volume: 0.7, speech: 'beats', countIn: false, calm: false};
            const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
            const SYMBOL_CYCLE = ['none', 'cow', 'tiger', 'pig', 'frog', 'up', 'down']; const BEHAVIOR_CYCLE = ['off', 'both', 'hear', 'display']; const SUBDIVISION_LABELS = ['1', 'e', 'AND', 'a'];
            const LOOKAHEAD_MS = 25.0; const SCHEDULE_AHEAD_TIME_SEC = 0.15;

            async function setupAudioContext() {
                try {
                    if (!audioContext || audioContext.state === 'closed') {
                        const Audio = window.AudioContext || window.webkitAudioContext;
                        if (!Audio) throw new Error('This browser does not support Web Audio.');
                        audioContext = new Audio({latencyHint: 'interactive'});
                        masterGain = audioContext.createGain();
                        masterGain.gain.value = preferences.volume;
                        masterGain.connect(audioContext.destination);
                    }
                    if (audioContext.state !== 'running') await audioContext.resume();
                    return audioContext.state === 'running';
                } catch (error) { announce('Could not start audio. ' + error.message); return false; }
            }
            function playTone(time, params, targetCtx, destinationNode) {
                const ctx = targetCtx || audioContext;
                if (!ctx || !params || params.vol <= 0) return;
                const dest = destinationNode || masterGain;
                const attack = Math.max(.001, params.fadeIn), release = Math.max(.001, params.fadeOut);
                const duration = Math.max(params.dur, attack + release);
                const osc = ctx.createOscillator(), gain = ctx.createGain();
                osc.type = params.type; osc.frequency.setValueAtTime(params.freq, time);
                gain.gain.setValueAtTime(0, time);
                gain.gain.linearRampToValueAtTime(params.vol, time + attack);
                gain.gain.setValueAtTime(params.vol, time + duration - release);
                gain.gain.linearRampToValueAtTime(0, time + duration);
                osc.connect(gain).connect(dest);
                if (!targetCtx) activeVoices.add(osc);
                osc.onended = () => { activeVoices.delete(osc); osc.disconnect(); gain.disconnect(); };
                osc.start(time); osc.stop(time + duration + .002);
            }
            function speakText(text) {
                if (!text?.trim() || !window.speechSynthesis || preferences.speech === 'off') return;
                // Do not build a late queue or cut off every word at the next subdivision.
                if (window.speechSynthesis.speaking || window.speechSynthesis.pending) return;
                const utterance = new SpeechSynthesisUtterance(text.trim());
                utterance.rate = 1.3; utterance.volume = preferences.volume;
                window.speechSynthesis.speak(utterance);
            }
            const SYMBOL_MAP = { none: 0, cow: 1, tiger: 2, pig: 3, frog: 4, up: 5, down: 6 }; const SYMBOL_MAP_REV = ["none", "cow", "tiger", "pig", "frog", "up", "down"];
            const BEHAVIOR_MAP = { off: 0, both: 1, hear: 2, display: 3 }; const BEHAVIOR_MAP_REV = ["off", "both", "hear", "display"];
            const WAVE_TYPE_MAP = { sine: 0, square: 1, triangle: 2, sawtooth: 3 }; const WAVE_TYPE_MAP_REV = ["sine", "square", "triangle", "sawtooth"];
            function padNum(num, len) { return num.toString().padStart(len, '0'); }
            function base64UrlEncode(u8Array) { const bs = String.fromCharCode(...u8Array); return btoa(bs).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
            function base64UrlDecode(str) { str = str.replace(/-/g, '+').replace(/_/g, '/'); while (str.length % 4) { str += '='; } const bs = atob(str); const len = bs.length; const bytes = new Uint8Array(len); for (let i = 0; i < len; i++) { bytes[i] = bs.charCodeAt(i); } return bytes; }

            function encodeSettingsCompact() {
                const data = {v:4, b:state.bpm, m:state.beatsPerMeasure, c5:state.c5, c6:state.c6,
                    soundParams:state.soundParams, patternConfig:state.patternConfig, displayMode:state.displayMode, preferences};
                return 'RT4.' + base64UrlEncode(new TextEncoder().encode(JSON.stringify(data)));
            }
            function decodeLegacySettings(encodedString) { try { const bytes = base64UrlDecode(encodedString); const packed = new TextDecoder().decode(bytes); let pos = 0; const read = (len) => { if (pos + len > packed.length) throw new Error("Unexpected end of string."); const sub = packed.substring(pos, pos + len); pos += len; return sub; }; const newSettings = { soundParams: {}, patternConfig: [] }; newSettings.b = parseInt(read(3), 10); newSettings.m = parseInt(read(1), 10); newSettings.c5 = '#' + read(6); newSettings.c6 = '#' + read(6); if (isNaN(newSettings.b) || newSettings.b < MIN_BPM || newSettings.b > MAX_BPM) throw new Error(`Invalid BPM (${newSettings.b}). Must be ${MIN_BPM}-${MAX_BPM}.`); if (isNaN(newSettings.m) || newSettings.m < 1 || newSettings.m > MAX_BEATS) throw new Error("Invalid Beats/Measure"); if (!/^#[0-9a-fA-F]{6}$/.test(newSettings.c5)) throw new Error("Invalid Color 5"); if (!/^#[0-9a-fA-F]{6}$/.test(newSettings.c6)) throw new Error("Invalid Color 6"); const defaultSPs = App.getDefaultState().soundParams; for (const key of SYMBOL_MAP_REV.slice(1)) { const freq = parseInt(read(4), 10); const vol = parseInt(read(2), 10) / 100; const dur = parseInt(read(4), 10) / 1000; const typeIndex = parseInt(read(1), 10); const fadeIn = parseInt(read(3), 10) / 1000; const fadeOut = parseInt(read(3), 10) / 1000; if (isNaN(freq) || isNaN(vol) || isNaN(dur) || isNaN(typeIndex) || isNaN(fadeIn) || isNaN(fadeOut)) { throw new Error(`Invalid sound param for ${key}`); } newSettings.soundParams[key] = { name: defaultSPs[key]?.name || key, emoji: defaultSPs[key]?.emoji || '', freq, vol, dur, type: WAVE_TYPE_MAP_REV[typeIndex] || 'sine', fadeIn, fadeOut }; } const totalSteps = newSettings.m * 4; for (let i = 0; i < totalSteps; i++) { const symbolIndex = parseInt(read(1), 10); const behaviorIndex = parseInt(read(1), 10); if(!Number.isInteger(symbolIndex) || !Number.isInteger(behaviorIndex) || symbolIndex >= SYMBOL_MAP_REV.length || behaviorIndex >= BEHAVIOR_MAP_REV.length) { throw new Error(`Invalid pattern index at ${i}`); } newSettings.patternConfig.push({ animal: SYMBOL_MAP_REV[symbolIndex], behavior: BEHAVIOR_MAP_REV[behaviorIndex], tts: '' }); } read((MAX_BEATS * 4 - totalSteps) * 2); for (let i = 0; i < totalSteps; i++) { if (pos + 2 > packed.length) break; const len = parseInt(read(2), 10); if (isNaN(len)) throw new Error(`Invalid TTS length at step ${i}`); if (pos + len > packed.length) break; const encodedTts = read(len); if (newSettings.patternConfig[i]) { newSettings.patternConfig[i].tts = decodeURIComponent(encodedTts); } } return newSettings; } catch (e) { console.error("Compact Decoding Error:", e); setStatusMessage(dom.clipboardStatusDiv, `Load Error: ${e.message}`, 'error'); return null; } }
            function renderSoundEditor() { dom.soundEditorGrid.innerHTML = ''; Object.entries(state.soundParams).forEach(([key, params]) => { const group = document.createElement('div'); group.className = 'sound-param-group'; group.innerHTML = `<h3> ${escapeHTML(params.name || key)} <button class="small-play-btn" data-symbol-key="${key}" aria-label="Preview ${escapeHTML(params.name || key)} sound">▶️</button> </h3> <div> <label for="${key}_freq">Freq</label> <input type="number" id="${key}_freq" data-symbol-key="${key}" data-param="freq" value="${params.freq}" min="20" max="5000" step="1"> </div> <div> <label for="${key}_vol">Vol</label> <input type="range" id="${key}_vol" data-symbol-key="${key}" data-param="vol" value="${params.vol}" min="0" max="1" step="0.01"> </div> <div> <label for="${key}_dur">Dur</label> <input type="number" id="${key}_dur" data-symbol-key="${key}" data-param="dur" value="${params.dur}" min="0.01" max="2" step="0.005"> </div> <div> <label for="${key}_type">Type</label> <select id="${key}_type" data-symbol-key="${key}" data-param="type"> ${['sine','square','triangle','sawtooth'].map(t=>`<option value="${t}" ${params.type===t?'selected':''}>${t[0].toUpperCase()+t.slice(1)}</option>`).join('')} </select> </div> <div> <label for="${key}_fadeIn">FadeIn</label> <input type="number" id="${key}_fadeIn" data-symbol-key="${key}" data-param="fadeIn" value="${params.fadeIn}" min="0.001" max="1" step="0.001"> </div> <div> <label for="${key}_fadeOut">FadeOut</label> <input type="number" id="${key}_fadeOut" data-symbol-key="${key}" data-param="fadeOut" value="${params.fadeOut}" min="0.001" max="1" step="0.001"> </div> <div> <label for="${key}_emoji">Display</label> <input type="text" id="${key}_emoji" data-symbol-key="${key}" data-param="emoji" value="${escapeHTML(params.emoji)}" maxlength="32"> </div>`; dom.soundEditorGrid.appendChild(group); }); dom.soundEditorGrid.querySelectorAll('input, select').forEach(input => { const eventType = (input.type === 'range' || input.type === 'number' || input.type === 'text') ? 'input' : 'change'; input.removeEventListener(eventType, handleSoundParamChange); input.addEventListener(eventType, handleSoundParamChange); }); }
            function renderPatternGrid() { dom.patternGrid.innerHTML = ''; const totalSteps = state.beatsPerMeasure * 4; if (!Array.isArray(state.patternConfig) || state.patternConfig.length !== totalSteps) { initPatternConfig(); } const headerHTML = `<div class="pattern-header">Beat</div>` + SUBDIVISION_LABELS.map(lbl => `<div class="pattern-header">${lbl}</div>`).join(''); dom.patternGrid.insertAdjacentHTML('beforeend', headerHTML); for (let beat = 0; beat < state.beatsPerMeasure; beat++) { const beatLabel = document.createElement('div'); beatLabel.className = 'beat-label';  beatLabel.textContent = beat + 1; dom.patternGrid.appendChild(beatLabel); for (let sub = 0; sub < 4; sub++) { const stepIndex = beat * 4 + sub; const stepDiv = document.createElement('div'); stepDiv.className = 'pattern-step'; stepDiv.id = `step-${stepIndex}`; stepDiv.dataset.index = stepIndex; stepDiv.setAttribute('role', state.patternEditMode === 'tts' ? 'group' : 'button'); stepDiv.setAttribute('tabindex', 0); renderPatternStep(stepDiv, state.patternConfig[stepIndex] || { animal: 'none', behavior: 'off', tts: ''}); dom.patternGrid.appendChild(stepDiv); } } }
            function renderPatternStep(stepElement, stepConfig) { if (state.patternEditMode === 'tts') { const ttsValue = stepConfig.tts || ''; stepElement.innerHTML = `<input type="text" class="tts-input" maxlength="500" value="${escapeHTML(ttsValue)}" aria-label="Spoken text for step ${stepElement.id.split('-')[1]}" placeholder="silent">`; } else { const symbolKey = stepConfig.animal; const symbolData = state.soundParams[symbolKey]; const displaySymbol = (symbolKey !== 'none' && symbolData?.emoji) ? symbolData.emoji : ' '; const ttsIndicator = (stepConfig.tts) ? '<span class="step-tts-indicator">🗣️</span>' : ''; stepElement.innerHTML = ` ${ttsIndicator} <span class="step-animal ${symbolKey}">${escapeHTML(displaySymbol)}</span> <span class="step-behavior ${stepConfig.behavior}">${stepConfig.behavior}</span> `; stepElement.setAttribute('aria-label', `Step ${stepElement.id.split('-')[1]}: ${displaySymbol} - ${stepConfig.behavior}. Click/Enter/Space to edit.`); } }

            function updateVisualDisplay(configuredSymbolKey, stepIndex) {
                let displayContent = '';
                let keyForStyling = 'none';
                const stepConfig = state.patternConfig[stepIndex];
                const behavior = stepConfig?.behavior || 'off';

                if (behavior === 'display' || behavior === 'both') {
                    keyForStyling = configuredSymbolKey !== 'none' ? configuredSymbolKey : 'none'; // Use configured key for style if display/both
                    if (state.displayMode === 'beat') {
                        if (stepIndex !== undefined && stepIndex >= 0) {
                            const subdivisionIndex = stepIndex % 4;
                            if (subdivisionIndex === 0) {
                                const beatNum = Math.floor(stepIndex / 4) + 1;
                                displayContent = beatNum.toString();
                            } else {
                                displayContent = SUBDIVISION_LABELS[subdivisionIndex] || '';
                            }
                        }
                    } else { // displayMode is 'symbol'
                        const symbolData = state.soundParams[configuredSymbolKey];
                        displayContent = (configuredSymbolKey && configuredSymbolKey !== 'none' && symbolData?.emoji) ? symbolData.emoji : '';
                    }
                } else {
                    displayContent = '';
                    keyForStyling = 'none';
                }
                dom.emojiDisplay.textContent = displayContent;
                dom.visualControlContainer.className = 'vis-' + keyForStyling;
                dom.visualControlContainer.classList.toggle('running', state.isRunning);
            }

            function updateInfoDisplay(beat, sub) { const subLabel = sub >= 0 ? (SUBDIVISION_LABELS[sub % 4] || '-') : '-'; const beatLabel = beat > 0 ? beat : '-'; dom.infoDisplay.textContent = `Beat: ${beatLabel} | Sub: ${subLabel}`; dom.visualArea.classList.toggle('running', state.isRunning); }
            function updateStepHighlight(index) { if (state.activeStepElement) { state.activeStepElement.classList.remove('active-step'); } if (index >= 0 && index < (state.beatsPerMeasure * 4)) { const newStepElement = dom.patternGrid?.querySelector(`#step-${index}`); if (newStepElement) { newStepElement.classList.add('active-step'); state.activeStepElement = newStepElement; } else { state.activeStepElement = null; } } else { state.activeStepElement = null; } }
            function updateControlsState() { const disable = state.isRunning; dom.bpmSlider.disabled = false; dom.bpmInput.disabled = false; dom.beatsPerMeasureSelect.disabled = disable; dom.displayModeSelect.disabled = disable; dom.soundEditorGrid?.querySelectorAll('input, select, button').forEach(el => el.disabled = disable); dom.patternGrid?.querySelectorAll('.pattern-step').forEach(el => { el.style.pointerEvents = disable ? 'none' : 'auto'; el.setAttribute('aria-disabled', String(disable)); if (disable) el.removeAttribute('tabindex'); else el.setAttribute('tabindex', 0); }); dom.editModeSelect.disabled = disable; dom.loadCodeButton.disabled = disable; dom.loadTextBoxButton.disabled = disable; dom.exportWavButton.disabled = disable; dom.copyCodeButton.disabled = disable; dom.editSoundsButton.disabled = disable; dom.editPatternButton.disabled = disable; dom.settingsButton.disabled = disable; dom.upArrowColorInput.disabled = disable; dom.downArrowColorInput.disabled = disable; dom.visualControlContainer.classList.toggle('running', disable); dom.visualControlContainer.setAttribute('aria-label', disable ? 'Stop Metronome' : 'Start Metronome'); document.getElementById('transport').textContent = disable ? 'Stop practice' : 'Start practice'; document.getElementById('transport').setAttribute('aria-pressed', String(disable)); document.getElementById('countIn').disabled = disable; document.getElementById('preset').disabled = disable; }
            function setStatusMessage(element, message, type = 'info', duration = 3500) { if (!element) return; element.textContent = message; element.className = type; if (duration > 0 && type !== 'warning' && type !== 'error') { setTimeout(() => { if (element.textContent === message && element.className === type) { element.textContent = ''; element.className = ''; } }, duration); } }
            async function copyCodeToClipboard() { const encodedSettings = encodeSettingsCompact(); if (!encodedSettings) { setStatusMessage(dom.clipboardStatusDiv, "Error creating code.", 'error'); return; } dom.settingsCodeTextarea.value = encodedSettings; if (navigator.clipboard && window.isSecureContext) { try { await navigator.clipboard.writeText(encodedSettings); setStatusMessage(dom.clipboardStatusDiv, "Code copied!", 'success'); return; } catch (err) { console.error('Clipboard API copy failed:', err); setStatusMessage(dom.clipboardStatusDiv, "Clipboard API failed, trying fallback...", 'warning'); } } try { dom.settingsCodeTextarea.select(); const successful = document.execCommand('copy'); if (successful) { setStatusMessage(dom.clipboardStatusDiv, "Copied (fallback).", 'success'); } else { throw new Error('execCommand failed'); } } catch (err) { console.error('Fallback copy failed:', err); setStatusMessage(dom.clipboardStatusDiv, "Copy failed. Select text manually.", 'error'); } window.getSelection()?.removeAllRanges(); }
            async function loadCodeFromClipboard() { if (!navigator.clipboard || !window.isSecureContext) { setStatusMessage(dom.clipboardStatusDiv, "Clipboard unavailable. Paste code and use 'Load from Text Box'.", 'warning', 0); return; } try { const text = await navigator.clipboard.readText(); if (text) { dom.settingsCodeTextarea.value = text; applyImportedSettings(text.trim()); } else { setStatusMessage(dom.clipboardStatusDiv, "Clipboard is empty.", 'warning'); } } catch (err) { console.error('Clipboard read failed:', err); if (err.name === 'NotAllowedError' || err.name === 'SecurityError') { setStatusMessage(dom.clipboardStatusDiv, "Permission denied. Paste & use 'Load from Text Box'.", 'error'); } else { setStatusMessage(dom.clipboardStatusDiv, "Clipboard error. Paste & use 'Load from Text Box'.", 'error'); } } }
            function handleLoadFromTextBox() { const text = dom.settingsCodeTextarea.value.trim(); if (text) { applyImportedSettings(text); } else { setStatusMessage(dom.clipboardStatusDiv, "Text box is empty.", 'warning'); } }
            function handleBpmChange(event) { const newBpm = parseInt(event.target.value, 10); if (!isNaN(newBpm) && newBpm >= MIN_BPM && newBpm <= MAX_BPM) { state.bpm = newBpm; if (dom.bpmInput) dom.bpmInput.value = state.bpm; } }
            function handleBpmInputChange(event) { const inputElement = event.target; let newBpm = parseInt(inputElement.value, 10); if (isNaN(newBpm)) return; newBpm = Math.max(MIN_BPM, Math.min(MAX_BPM, newBpm)); state.bpm = newBpm; if (dom.bpmSlider) dom.bpmSlider.value = state.bpm; if (parseInt(inputElement.value, 10) !== newBpm) { inputElement.value = newBpm; } }
            function handleTimeSigChange(event) { if (state.isRunning) { alert("Stop the metronome to change beats per measure."); event.target.value = state.beatsPerMeasure; return; } const previous = state.patternConfig; state.beatsPerMeasure = parseInt(event.target.value, 10); initPatternConfig(); state.patternConfig = state.patternConfig.map((step,i) => previous[i] || step); renderBeatStrip(); renderPatternGrid(); state.current16thNote = 0; updateInfoDisplay(0, -1); updateStepHighlight(-1); updateVisualDisplay('none', -1); }
            function handleDisplayModeChange(event) { state.displayMode = event.target.value; if (state.isRunning && state.activeStepElement) { const stepIndex = parseInt(state.activeStepElement.dataset.index, 10); if (!isNaN(stepIndex)) { const stepConfig = state.patternConfig[stepIndex]; updateVisualDisplay(stepConfig.animal, stepIndex); } } else if (!state.isRunning) { updateVisualDisplay('none', -1); } }
            async function handleStartStop() {
                if (state.isRunning || starting) { stopMetronome(); updateControlsState(); return; }
                starting = true; const token = ++generation;
                document.getElementById('transport').textContent = 'Cancel start';
                if (await setupAudioContext() && token === generation) startMetronome();
                starting = false; updateControlsState();
            }
            function handleVisualControlKeyPress(event) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); handleStartStop(); } }
            function handleOpenModal(event) { const modalId = event.currentTarget.dataset.modalId; const modal = document.getElementById(modalId); if (modal?.showModal) { if (modalId === 'settingsModal') { if (!window.isSecureContext) { setStatusMessage(dom.clipboardStatusDiv, "Warning: Clipboard functions may fail (not HTTPS/secure context).", 'warning', 0); } else if (dom.clipboardStatusDiv.className === 'warning') { setStatusMessage(dom.clipboardStatusDiv, '', 'info', 0); } } modal.showModal(); } else { console.error("Modal not found:", modalId); } }
            function handleCloseModal(event) { event.target.closest('dialog')?.close(); }
            function handleSoundParamChange(event) { const input = event.target; const symbolKey = input.dataset.symbolKey; const param = input.dataset.param; let value; if (input.type === 'number' || input.type === 'range') { value = parseFloat(input.value); if (!Number.isFinite(value)) return; value = Math.max(Number(input.min), Math.min(Number(input.max), value)); } else { value = input.value; } if (symbolKey && param && state.soundParams[symbolKey]?.[param] !== undefined) { state.soundParams[symbolKey][param] = value; if (param === 'emoji') { renderPatternGrid(); const currentlyDisplayedSymbol = dom.visualControlContainer.className.split(' ').find(c => c.startsWith('vis-'))?.substring(4); if (currentlyDisplayedSymbol === symbolKey && state.displayMode === 'symbol') { updateVisualDisplay(symbolKey, state.activeStepElement ? Number(state.activeStepElement.dataset.index) : -1); } } } else { console.warn("Invalid sound param update:", { symbolKey, param, value }); } }
            function handlePatternModeChange(event) { state.patternEditMode = event.target.value; renderPatternGrid(); }
            function handlePatternGridClick(event) { if (state.isRunning || state.patternEditMode === 'tts') return; const stepElement = event.target.closest('.pattern-step'); if (!stepElement) return; const index = parseInt(stepElement.dataset.index, 10); if (isNaN(index) || !state.patternConfig || index >= state.patternConfig.length) { console.error("Invalid step click:", index); return; } const mode = state.patternEditMode; const currentStepConfig = state.patternConfig[index]; const cycleArray = (mode === 'animal') ? SYMBOL_CYCLE : BEHAVIOR_CYCLE; const currentVal = currentStepConfig[mode]; const currentIndex = cycleArray.indexOf(currentVal); const nextIndex = (currentIndex + 1) % cycleArray.length; const nextVal = cycleArray[nextIndex]; state.patternConfig[index][mode] = nextVal; renderPatternStep(stepElement, state.patternConfig[index]); }
            function handleTtsInputChange(event) { const input = event.target; if (!input.classList.contains('tts-input')) return; const stepElement = input.closest('.pattern-step'); if (!stepElement) return; const index = parseInt(stepElement.dataset.index, 10); if (isNaN(index) || !state.patternConfig || index >= state.patternConfig.length) return; state.patternConfig[index].tts = input.value; }
            function handlePatternKeyPress(event) { if (state.isRunning || event.target.matches('input, textarea')) return; if (event.key === 'Enter' || event.key === ' ') { const stepElement = event.target.closest('.pattern-step'); if (stepElement) { event.preventDefault(); handlePatternGridClick({ target: stepElement }); } } }
            function handleExportWav() { exportAudio(); }
            function handleColorChange(event) { const cssVar = event.target.dataset.cssVar; const stateKey = event.target.dataset.stateKey; const newColor = event.target.value; if (cssVar && stateKey && newColor) { document.documentElement.style.setProperty(cssVar, newColor); state[stateKey] = newColor; } }
            async function handlePreviewSound(event) { const button = event.target.closest('.small-play-btn'); if (!button) return; const symbolKey = button.dataset.symbolKey; if (!symbolKey || !state.soundParams[symbolKey]) { console.error("Invalid symbol key for preview:", symbolKey); return; } if (!await setupAudioContext()) { alert("Audio Context needed. Please interact with the page first."); return; } const params = state.soundParams[symbolKey]; playTone(audioContext.currentTime, params); }
            function applyImportedSettings(encodedString) {
                const settings = decodeSettingsCompact(encodedString);
                if (!settings) return false;
                stopMetronome();
                Object.assign(state, {bpm:settings.b, beatsPerMeasure:settings.m, soundParams:settings.soundParams,
                    patternConfig:settings.patternConfig, c5:settings.c5, c6:settings.c6, displayMode:settings.displayMode || 'symbol'});
                Object.assign(preferences, settings.preferences || {});
                dom.upArrowColorInput.value = state.c5; dom.downArrowColorInput.value = state.c6;
                document.documentElement.style.setProperty('--accent-color-5', state.c5);
                document.documentElement.style.setProperty('--accent-color-6', state.c6);
                dom.bpmSlider.value = dom.bpmInput.value = state.bpm;
                dom.beatsPerMeasureSelect.value = state.beatsPerMeasure; dom.displayModeSelect.value = state.displayMode;
                renderSoundEditor(); renderPatternGrid(); syncPracticeControls(); renderBeatStrip();
                updateControlsState(); updateInfoDisplay(0,-1); updateVisualDisplay('none',-1);
                setStatusMessage(dom.clipboardStatusDiv, 'Settings loaded.', 'success'); saveSettings(); return true;
            }
            function audioBufferToWav(buffer, opt = {}) { const numChannels = buffer.numberOfChannels; const sampleRate = buffer.sampleRate; const format = opt.float32 ? 3 : 1; const bitDepth = format === 3 ? 32 : 16; let result; if (numChannels === 2) { result = interleave(buffer.getChannelData(0), buffer.getChannelData(1)); } else { result = buffer.getChannelData(0); } return encodeWAV(result, format, sampleRate, numChannels, bitDepth); }
            function encodeWAV(samples, format, sampleRate, numChannels, bitDepth) { const bytesPerSample = bitDepth / 8; const blockAlign = numChannels * bytesPerSample; const numSamples = samples.length; const dataSize = numSamples * bytesPerSample; const buffer = new ArrayBuffer(44 + dataSize); const view = new DataView(buffer); function writeString(v,o,s){for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i));} function floatTo16(o,f,i){for(let j=0;j<i.length;j++,f+=2){const s=Math.max(-1,Math.min(1,i[j]));o.setInt16(f,s<0?s*0x8000:s*0x7FFF,true);}} function writeFloat(o,f,i){for(let j=0;j<i.length;j++,f+=4)o.setFloat32(f,i[j],true);} writeString(view,0,'RIFF'); view.setUint32(4,36+dataSize,true); writeString(view,8,'WAVE'); writeString(view,12,'fmt '); view.setUint32(16,16,true); view.setUint16(20,format,true); view.setUint16(22,numChannels,true); view.setUint32(24,sampleRate,true); view.setUint32(28,sampleRate*blockAlign,true); view.setUint16(32,blockAlign,true); view.setUint16(34,bitDepth,true); writeString(view,36,'data'); view.setUint32(40,dataSize,true); if(format===1) floatTo16(view,44,samples); else writeFloat(view,44,samples); return buffer; }
            function interleave(l,r){const len=l.length+r.length; const res=new Float32Array(len); let i=0,j=0; while(i<len){res[i++]=l[j];res[i++]=r[j];j++;} return res;}
            function triggerDownload(blob,filename){const url=URL.createObjectURL(blob);const a=document.createElement("a");document.body.appendChild(a);a.style="display:none";a.href=url;a.download=filename;a.click();setTimeout(() => window.URL.revokeObjectURL(url), 10000);document.body.removeChild(a);}
            async function exportAudio() { if (state.isRunning) { alert("Please stop the metronome before exporting."); return; } if (!window.OfflineAudioContext) { setStatusMessage(dom.exportStatusDiv, "Offline Audio Rendering not supported.", 'error'); return; } const durationSec = parseFloat(dom.exportDurationInput.value); if (!Number.isFinite(durationSec) || durationSec < 1 || durationSec > MAX_EXPORT_DURATION_SEC) { setStatusMessage(dom.exportStatusDiv, `Invalid duration (1-${MAX_EXPORT_DURATION_SEC}s).`, 'error'); return; } setStatusMessage(dom.exportStatusDiv, "Rendering audio...", 'processing', 0); dom.exportWavButton.disabled = true; try { const sampleRate = 44100; const numChannels = 1; const totalSamples = Math.floor(sampleRate * durationSec); const offlineCtx = new OfflineAudioContext(numChannels, totalSamples, sampleRate); const exportGain = offlineCtx.createGain(); exportGain.gain.value = preferences.volume; exportGain.connect(offlineCtx.destination); let currentTime = 0.0; let export16thNote = 0; const patternLength = state.patternConfig.length; const secondsPer16thNote = 60.0 / state.bpm / 4.0; while (currentTime < durationSec) { const stepConfig = state.patternConfig[export16thNote % patternLength]; if (stepConfig) { const { animal, behavior } = stepConfig; const shouldHear = (behavior === 'hear' || behavior === 'both') && animal !== 'none'; if (shouldHear) { const params = state.soundParams[animal]; if (params) { playTone(currentTime, params, offlineCtx, exportGain); } } } if (shouldSpeak(export16thNote % patternLength)) scheduleSpeech(stepConfig.tts,currentTime,speechWindow(export16thNote % patternLength),offlineCtx,exportGain,false); currentTime += secondsPer16thNote; export16thNote++; } const renderedBuffer = await offlineCtx.startRendering(); const wavBuffer = audioBufferToWav(renderedBuffer, { float32: false }); const blob = new Blob([wavBuffer], { type: 'audio/wav' }); const filename = `metronome_${state.bpm}bpm_${state.beatsPerMeasure}beats_${durationSec}s.wav`; triggerDownload(blob, filename); setStatusMessage(dom.exportStatusDiv, "Export complete!", 'success'); } catch (error) { console.error("Audio Export Error:", error); setStatusMessage(dom.exportStatusDiv, `Export failed: ${error.message}`, 'error'); } finally { dom.exportWavButton.disabled = false; } }

            function scheduler() {
                if (!state.isRunning) return;
                if (audioContext.state !== 'running') { stopMetronome(); updateControlsState(); announce('Audio interrupted. Tap Start to resume.'); return; }
                const now = audioContext.currentTime;
                const interval = 60 / state.bpm / 4;
                // Skip missed subdivisions after a stall; never replay a burst of old beats.
                if (state.nextNoteTime < now - .03) {
                    const missed = Math.ceil((now - state.nextNoteTime) / interval);
                    if (countRemaining) { countRemaining = 0; state.current16thNote = 0; }
                    else state.current16thNote = (state.current16thNote + missed) % state.patternConfig.length;
                    state.nextNoteTime += missed * interval;
                    visualQueue = [];
                }
                while (state.nextNoteTime < now + SCHEDULE_AHEAD_TIME_SEC) {
                    const time = state.nextNoteTime;
                    if (countRemaining > 0) {
                        const beat = state.beatsPerMeasure - countRemaining + 1;
                        playTone(time, state.soundParams[beat === 1 ? 'cow' : 'tiger']);
                        if (preferences.speech !== 'off') scheduleSpeech(String(beat),time,60/state.bpm); visualQueue.push({time, count:beat}); countRemaining--;
                        state.nextNoteTime += 60 / state.bpm;
                        continue;
                    }
                    const index = state.current16thNote, step = state.patternConfig[index];
                    if (['hear','both'].includes(step.behavior) && step.animal !== 'none') playTone(time, state.soundParams[step.animal]);
                    const sampled = shouldSpeak(index) && scheduleSpeech(step.tts,time,speechWindow(index)); visualQueue.push({time, index, sampled});
                    state.nextNoteTime += interval;
                    state.current16thNote = (index + 1) % state.patternConfig.length;
                }
                timerID = setTimeout(scheduler, LOOKAHEAD_MS);
            }
            function audibleTime() {
                const stamp = audioContext.getOutputTimestamp?.();
                if (stamp?.contextTime > 0 && stamp.performanceTime > 0) return stamp.contextTime + (performance.now() - stamp.performanceTime) / 1000;
                return audioContext.currentTime - (audioContext.outputLatency || 0);
            }
            function drawFrame() {
                if (!state.isRunning) return;
                const now = audibleTime(); let latest;
                while (visualQueue.length && visualQueue[0].time <= now) latest = visualQueue.shift();
                if (latest) {
                    if (latest.count) {
                        dom.emojiDisplay.textContent = latest.count;
                        dom.infoDisplay.textContent = 'Get ready · ' + latest.count + ' of ' + state.beatsPerMeasure;
                    } else {
                        const {index} = latest, step = state.patternConfig[index];
                        updateInfoDisplay(Math.floor(index / 4) + 1, index % 4);
                        updateVisualDisplay(step.animal, index); updateStepHighlight(index); updateBeatStrip(index);
                        if (shouldSpeak(index) && !latest.sampled) speakText(step.tts);
                    }
                }
                animationID = requestAnimationFrame(drawFrame);
            }
            function startMetronome() {
                state.isRunning = true; state.current16thNote = 0;
                state.nextNoteTime = audioContext.currentTime + .12;
                countRemaining = preferences.countIn ? state.beatsPerMeasure : 0;
                visualQueue = []; renderBeatStrip(); scheduler(); drawFrame();
                announce('Practice started.');
                const token = generation;
                navigator.wakeLock?.request('screen').then(lock => {
                    if (state.isRunning && token === generation) wakeLock = lock; else lock.release();
                }).catch(() => {});
            }
            function stopMetronome() {
                ++generation; starting = false; state.isRunning = false;
                clearTimeout(timerID); cancelAnimationFrame(animationID); visualQueue = [];
                for (const voice of activeVoices) { try { voice.stop(); } catch (_) {} }
                activeVoices.clear(); window.speechSynthesis?.cancel();
                wakeLock?.release().catch(() => {}); wakeLock = null;
                updateStepHighlight(-1); updateInfoDisplay(0,-1); updateVisualDisplay('none',-1); updateBeatStrip(-1);
            }

            function getDefaultState() { return JSON.parse(JSON.stringify({ bpm: 120, beatsPerMeasure: 4, soundParams: { cow: { name: "Cow 🐮", emoji: "🐮", freq: 110, dur: 0.20, fadeIn: 0.01, fadeOut: 0.18, type: 'sawtooth', vol: 0.6 }, tiger: { name: "Tiger 🐯", emoji: "🐯", freq: 400, dur: 0.15, fadeIn: 0.005, fadeOut: 0.12, type: 'square', vol: 0.4 }, pig: { name: "Pig 🐷", emoji: "🐷", freq: 880, dur: 0.08, fadeIn: 0.002, fadeOut: 0.07, type: 'triangle', vol: 0.35 }, frog: { name: "Frog 🐸", emoji: "🐸", freq: 1400, dur: 0.06, fadeIn: 0.001, fadeOut: 0.05, type: 'sine', vol: 0.3 }, up: { name: "Up ↑", emoji: "↑", freq: 750, dur: 0.05, fadeIn: 0.001, fadeOut: 0.04, type: 'sine', vol: 0.35 }, down: { name: "Down ↓", emoji: "↓", freq: 500, dur: 0.07, fadeIn: 0.001, fadeOut: 0.06, type: 'sine', vol: 0.4 } }, patternConfig: [], c5: '#8b5cf6', c6: '#64748b', displayMode: 'symbol', patternEditMode: 'animal' })); }
            function initPatternConfig() { state.patternConfig = []; const totalSteps = state.beatsPerMeasure * 4; const COUNT_WORDS = ["", "one", "two", "three", "four", "five", "six", "seven", "eight"]; for (let i = 0; i < totalSteps; i++) { const beatNum = Math.floor(i / 4) + 1; const subNum = i % 4; let animal = 'none', behavior = 'off', tts = ''; if (subNum === 0) { animal = (beatNum === 1) ? 'cow' : 'tiger'; behavior = 'both'; tts = COUNT_WORDS[beatNum] || beatNum.toString(); } else { tts = SUBDIVISION_LABELS[subNum] || ''; } state.patternConfig.push({ animal, behavior, tts }); } console.log(`Pattern config initialized for ${state.beatsPerMeasure} beats.`); }
            function cacheDomElements() { dom.appContainer = document.getElementById('appContainer'); dom.bpmSlider = document.getElementById('bpmSlider'); dom.bpmInput = document.getElementById('bpmInput'); dom.visualArea = document.getElementById('visualArea'); dom.visualControlContainer = document.getElementById('visualControlContainer'); dom.emojiDisplay = document.getElementById('emojiDisplay'); dom.infoDisplay = document.getElementById('infoDisplay'); dom.settingsButton = document.getElementById('settingsButton'); dom.beatsPerMeasureSelect = document.getElementById('beatsPerMeasure'); dom.displayModeSelect = document.getElementById('displayMode'); dom.soundEditorGrid = document.getElementById('soundEditorGrid'); dom.patternGrid = document.getElementById('patternGrid'); dom.settingsCodeTextarea = document.getElementById('settingsCode'); dom.copyCodeButton = document.getElementById('copyCodeButton'); dom.loadCodeButton = document.getElementById('loadCodeButton'); dom.loadTextBoxButton = document.getElementById('loadTextBoxButton'); dom.clipboardStatusDiv = document.getElementById('clipboardStatus'); dom.editModeSelect = document.getElementById('editModeSelect'); dom.editSoundsButton = document.getElementById('editSoundsButton'); dom.editPatternButton = document.getElementById('editPatternButton'); dom.exportDurationInput = document.getElementById('exportDuration'); dom.exportWavButton = document.getElementById('exportWavButton'); dom.exportStatusDiv = document.getElementById('exportStatus'); dom.upArrowColorInput = document.getElementById('upArrowColor'); dom.downArrowColorInput = document.getElementById('downArrowColor'); }
            function bindEventListeners() { dom.bpmSlider.addEventListener('input', handleBpmChange); dom.bpmInput.addEventListener('input', handleBpmInputChange); dom.beatsPerMeasureSelect.addEventListener('change', handleTimeSigChange); dom.displayModeSelect.addEventListener('change', handleDisplayModeChange); dom.visualControlContainer.addEventListener('click', handleStartStop); dom.visualControlContainer.addEventListener('keydown', handleVisualControlKeyPress); dom.copyCodeButton.addEventListener('click', copyCodeToClipboard); dom.loadCodeButton.addEventListener('click', loadCodeFromClipboard); dom.loadTextBoxButton.addEventListener('click', handleLoadFromTextBox); dom.editModeSelect.addEventListener('change', handlePatternModeChange); dom.patternGrid.addEventListener('click', handlePatternGridClick); dom.patternGrid.addEventListener('input', handleTtsInputChange); dom.patternGrid.addEventListener('keydown', handlePatternKeyPress); dom.settingsButton.addEventListener('click', handleOpenModal); document.querySelectorAll('#settingsModal button[data-modal-id]').forEach(btn => { btn.addEventListener('click', handleOpenModal); }); document.querySelectorAll('.modal-close-btn').forEach(btn => { btn.addEventListener('click', handleCloseModal); }); document.querySelectorAll('dialog').forEach(dialog => { dialog.addEventListener('click', (event) => { if (event.target === dialog) { dialog.close(); } }); }); dom.exportWavButton.addEventListener('click', handleExportWav); dom.upArrowColorInput.addEventListener('input', handleColorChange); dom.downArrowColorInput.addEventListener('input', handleColorChange); dom.soundEditorGrid.addEventListener('click', handlePreviewSound); }
            function init() { console.log("Initializing Rhythm Tool Pro..."); cacheDomElements(); const defaultState = getDefaultState(); state = {...defaultState, ...state}; initPatternConfig(); dom.bpmSlider.value = state.bpm; dom.bpmInput.value = state.bpm; renderSoundEditor(); renderPatternGrid(); updateVisualDisplay('none', -1); updateInfoDisplay(0, -1); dom.upArrowColorInput.value = state.c5; dom.downArrowColorInput.value = state.c6; document.documentElement.style.setProperty('--accent-color-5', state.c5); document.documentElement.style.setProperty('--accent-color-6', state.c6); dom.displayModeSelect.value = state.displayMode; dom.editModeSelect.value = state.patternEditMode; updateControlsState(); bindEventListeners(); initPractice(); console.log("Rhythm Tool Pro Initialized"); }
            const speechBuffers = new Map();
            function speechKey(text) {
                const word = String(text || '').trim().toLowerCase();
                return ({'1':'one','2':'two','3':'three','4':'four','5':'five','6':'six','7':'seven','8':'eight','&':'and','+':'and','↑':'up','↓':'down'})[word] || word;
            }
            function getSpeechBuffer(text, ctx) {
                const key = speechKey(text);
                if (speechBuffers.has(key)) return speechBuffers.get(key);
                const encoded = typeof RHYTHM_VOICES !== 'undefined' && RHYTHM_VOICES[key];
                if (!encoded) return null;
                const raw = atob(encoded), buffer = ctx.createBuffer(1,raw.length/2,16000), samples = buffer.getChannelData(0);
                for (let i=0;i<samples.length;i++) { let value=raw.charCodeAt(i*2) | raw.charCodeAt(i*2+1)<<8; if (value>=32768) value-=65536; samples[i]=value/32768; }
                speechBuffers.set(key, buffer); return buffer;
            }
            function shouldSpeak(index) { return preferences.speech === 'all' || (preferences.speech === 'beats' && index%4 === 0); }
            function speechWindow(index) {
                for (let offset=1;offset<=state.patternConfig.length;offset++) {
                    const next=(index+offset)%state.patternConfig.length;
                    if (shouldSpeak(next) && state.patternConfig[next].tts.trim()) return offset*60/state.bpm/4;
                }
                return 60/state.bpm;
            }
            function scheduleSpeech(text, time, windowSec, ctx=audioContext, destination=masterGain, track=true) {
                const buffer=getSpeechBuffer(text,ctx); if (!buffer) return false;
                const source=ctx.createBufferSource(); source.buffer=buffer;
                // Fit each entire count before the next one. No cancellation or busy-voice skipping.
                source.playbackRate.value=Math.max(1,buffer.duration/Math.max(.025,windowSec*.9));
                source.connect(destination);
                if (track) activeVoices.add(source);
                source.onended=()=>{ activeVoices.delete(source); source.disconnect(); };
                source.start(time); return true;
            }

            function validateSettings(data) {
                const fail = () => { throw new Error('Invalid or unsupported settings.'); };
                const number = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
                if (!data || !Number.isInteger(data.b) || !number(data.b,1,300) || !Number.isInteger(data.m) || !number(data.m,1,8)) fail();
                if (![data.c5,data.c6].every(c => typeof c === 'string' && /^#[\da-f]{6}$/i.test(c))) fail();
                const sounds = getDefaultState().soundParams;
                for (const key of SYMBOL_MAP_REV.slice(1)) {
                    const sound = data.soundParams?.[key];
                    if (!sound || !number(sound.freq,20,9999) || !number(sound.vol,0,1) || !number(sound.dur,.001,10) || !number(sound.fadeIn,0,1) || !number(sound.fadeOut,0,1) || !WAVE_TYPE_MAP_REV.includes(sound.type)) fail();
                    if (typeof sound.emoji !== 'string' || sound.emoji.length > 32) fail();
                    for (const prop of ['freq','vol','dur','fadeIn','fadeOut','type','emoji']) sounds[key][prop] = sound[prop];
                }
                if (!Array.isArray(data.patternConfig) || data.patternConfig.length !== data.m * 4) fail();
                const pattern = data.patternConfig.map(step => {
                    if (!step || !SYMBOL_CYCLE.includes(step.animal) || !BEHAVIOR_CYCLE.includes(step.behavior) || typeof step.tts !== 'string' || step.tts.length > 500) fail();
                    return {animal:step.animal, behavior:step.behavior, tts:step.tts};
                });
                const p = data.preferences || {volume:.7, speech:'all', countIn:false, calm:false};
                if (!number(p.volume,0,1) || !['off','beats','all'].includes(p.speech) || typeof p.countIn !== 'boolean' || typeof p.calm !== 'boolean') fail();
                if (data.displayMode && !['symbol','beat'].includes(data.displayMode)) fail();
                return {b:data.b,m:data.m,c5:data.c5,c6:data.c6,soundParams:sounds,patternConfig:pattern,displayMode:data.displayMode || 'symbol', preferences:{volume:p.volume,speech:p.speech,countIn:p.countIn,calm:p.calm}};
            }
            function decodeSettingsCompact(code) {
                try {
                    if (typeof code !== 'string' || code.length > 200000) throw new Error('Settings code is too large.');
                    code = code.trim();
                    let data;
                    if (code.startsWith('RT4.')) {
                        data = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(base64UrlDecode(code.slice(4))));
                        if (data.v !== 4) throw new Error('Unsupported settings version.');
                    } else data = decodeLegacySettings(code);
                    return validateSettings(data);
                } catch (error) { setStatusMessage(dom.clipboardStatusDiv, 'Load error: ' + error.message, 'error'); return null; }
            }
            function announce(message) { document.getElementById('appStatus').textContent = message; }
            function saveSettings() {
                try { localStorage.setItem('rhythm-tool-v4', encodeSettingsCompact()); }
                catch (_) { announce('Automatic saving is unavailable. Use Copy Code to keep your settings.'); }
            }
            function syncPracticeControls() {
                document.getElementById('volume').value = Math.round(preferences.volume * 100);
                document.getElementById('volumeValue').textContent = Math.round(preferences.volume * 100) + '%';
                document.getElementById('speech').value = preferences.speech;
                document.getElementById('countIn').checked = preferences.countIn;
                document.getElementById('calm').checked = preferences.calm;
                document.body.classList.toggle('calm', preferences.calm);
                if (masterGain) masterGain.gain.setTargetAtTime(preferences.volume,audioContext.currentTime,.01);
            }
            function renderBeatStrip() {
                const strip = document.getElementById('beatStrip'); strip.textContent = '';
                for (let i=0;i<state.beatsPerMeasure;i++) {
                    const beat = document.createElement('span'); beat.className = 'beat-chip'; beat.textContent = i+1;
                    strip.appendChild(beat);
                }
            }
            function updateBeatStrip(index) {
                document.querySelectorAll('.beat-chip').forEach((chip,i) => chip.classList.toggle('current', index >= 0 && i === Math.floor(index/4)));
                const cue = document.getElementById('nextCue');
                if (index < 0) { cue.textContent = 'Press Start when you’re ready.'; return; }
                for (let offset=1;offset<=state.patternConfig.length;offset++) {
                    const next = (index+offset) % state.patternConfig.length, step = state.patternConfig[next];
                    if (['display','both'].includes(step.behavior)) {
                        const symbol = state.soundParams[step.animal]?.emoji || 'Beat';
                        cue.textContent = 'Next: ' + symbol + ' · ' + (Math.floor(next/4)+1) + (next%4 ? ' ' + SUBDIVISION_LABELS[next%4] : ''); return;
                    }
                }
                cue.textContent = 'Follow the numbered beats.';
            }
            function initPractice() {
                let taps = [];
                const setTempo = bpm => { state.bpm = Math.max(1,Math.min(300,Math.round(bpm))); dom.bpmInput.value = dom.bpmSlider.value = state.bpm; saveSettings(); };
                const tap = () => {
                    const now = performance.now();
                    if (taps.length && now-taps[taps.length-1] > 2500) taps=[];
                    if (taps.length && now-taps[taps.length-1] < 120) return;
                    taps.push(now); taps=taps.slice(-9);
                    if (taps.length>1) { const intervals=taps.slice(1).map((t,i)=>t-taps[i]).sort((a,b)=>a-b); const middle=Math.floor(intervals.length/2); const median=intervals.length%2 ? intervals[middle] : (intervals[middle-1]+intervals[middle])/2; setTempo(60000/median); announce('Tap tempo: ' + state.bpm + ' BPM.'); }
                    else announce('Keep tapping a steady beat.');
                };
                document.getElementById('transport').addEventListener('click',handleStartStop);
                document.getElementById('slower').addEventListener('click',()=>setTempo(state.bpm-5));
                document.getElementById('faster').addEventListener('click',()=>setTempo(state.bpm+5));
                document.getElementById('tapTempo').addEventListener('click',tap);
                document.getElementById('volume').addEventListener('input',e=>{ preferences.volume=Number(e.target.value)/100; syncPracticeControls(); });
                document.getElementById('speech').addEventListener('change',e=>{ preferences.speech=e.target.value; window.speechSynthesis?.cancel(); });
                document.getElementById('countIn').addEventListener('change',e=>preferences.countIn=e.target.checked);
                document.getElementById('calm').addEventListener('change',e=>{ preferences.calm=e.target.checked; syncPracticeControls(); });
                document.getElementById('preset').addEventListener('change',e=>{
                    const preset=e.target.value; if (!preset || state.isRunning) return;
                    if (preset==='island') { state.beatsPerMeasure=4; dom.beatsPerMeasureSelect.value=4; }
                    initPatternConfig();
                    state.patternConfig.forEach((step,i)=>{
                        const on = preset==='sixteenths' || (preset==='eighths' ? i%2===0 : preset==='island' ? [0,4,6,10,12,14].includes(i) : i%4===0);
                        step.behavior=on?'both':'off';
                        step.animal=on ? (preset==='eighths' || preset==='island' ? (i%4===0?'down':'up') : i%4===0 ? (i===0?'cow':'tiger') : 'pig') : 'none';
                    });
                    renderPatternGrid(); renderBeatStrip(); saveSettings(); e.target.value=''; announce('Practice pattern applied.');
                });
                document.addEventListener('keydown',e=>{
                    if (e.repeat || e.ctrlKey || e.altKey || e.metaKey || e.target.closest('input,select,textarea,button,[role="button"],dialog,summary')) return;
                    if (e.code==='Space') { e.preventDefault(); handleStartStop(); }
                    else if (e.key.toLowerCase()==='t') tap();
                    else if (e.key==='ArrowUp' || e.key==='ArrowDown') { e.preventDefault(); setTempo(state.bpm + (e.key==='ArrowUp'?1:-1)); }
                });
                document.addEventListener('visibilitychange',()=>{
                    if (document.hidden && (state.isRunning || starting)) { stopMetronome(); updateControlsState(); announce('Paused while the page is hidden. Tap Start when you return.'); }
                });
                // Delegated saving runs after each control's own handler, including pattern edits.
                for (const type of ['input','change','click']) document.addEventListener(type,e=>{ if (e.target.closest('input,select,.pattern-step')) saveSettings(); });
                dom.bpmInput.addEventListener('blur',()=>{ dom.bpmInput.value=state.bpm; });
                renderBeatStrip(); syncPracticeControls();
                try { const saved=localStorage.getItem('rhythm-tool-v4'); if (saved) { if (applyImportedSettings(saved)) announce('Your last practice settings are restored.'); else announce('Saved settings could not be read. Default settings are ready.'); } } catch (_) {}
                if (!window.speechSynthesis) announce('Standard counts are ready. Custom browser speech is unavailable.');
            }

            return { init, getDefaultState };
        })();
        document.addEventListener('DOMContentLoaded', App.init);
    