import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
        import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } 
            from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
        import { getFirestore, doc, setDoc, getDoc, collection, getDocs, updateDoc, increment, writeBatch, addDoc, serverTimestamp } 
            from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

        const firebaseConfig = {
            apiKey: "AIzaSyAYatcV4UyTrn4_Wf2HVzdIwM97buXGxLA",
            authDomain: "agenthtml-5f5fb.firebaseapp.com",
            projectId: "agenthtml-5f5fb",
            storageBucket: "agenthtml-5f5fb.firebasestorage.app",
            messagingSenderId: "880525619742",
            appId: "1:880525619742:web:fd6cb57926abb4f5ddb40f",
            measurementId: "G-L8906M810M"
        };
        const app = initializeApp(firebaseConfig);
        const auth = getAuth(app);
        const db = getFirestore(app);

        const state = {
            user: null, questionsDB: [], subjects: [], currentSubject: null, currentChapter: null, userStats: null,
            quiz: { 
                questions: [], currentIndex: 0, score: 0, mistakes: [], startTime: 0, durationSec: 0, isAnswered: false,
                qStartTime: 0 
            }
        };

        const $ = (id) => document.getElementById(id);

        const nav = {
            screens: ['auth', 'home', 'subject', 'quiz', 'result', 'mypage'],
            go: (targetScreen) => {
                nav.screens.forEach(s => {
                    const el = $(`screen-${s}`);
                    if (el) el.classList.toggle('active', s === targetScreen);
                });
                
                $('header').classList.toggle('hidden', targetScreen === 'auth' || targetScreen === 'quiz');

                if (targetScreen === 'home') renderApp.home();
                if (targetScreen === 'subject') renderApp.subject();
                if (targetScreen === 'mypage') renderApp.mypage();
            },
            setLoading: (isLoading) => $('loading').classList.toggle('hidden', !isLoading)
        };

        const dataApp = {
            ensureUserDoc: async (uid) => {
                const userDocRef = doc(db, 'users', uid);
                const snap = await getDoc(userDocRef);
                if (!snap.exists()) {
                    await setDoc(userDocRef, { 
                        name: '',
                        email: state.user?.email || '',
                        stats: { 
                            totalAnswered: 0, 
                            totalCorrect: 0, 
                            totalTimeSeconds: 0, 
                            sessionCount: 0,
                            minQuestionTime: null,
                            maxQuestionTime: 0,
                            bestAccuracy: 0,
                            bestSessionTime: null
                        } 
                    });
                }
            },
            fetchUserData: async (uid) => {
                const userDocRef = doc(db, 'users', uid);
                const snap = await getDoc(userDocRef);
                if (snap.exists()) {
                    const data = snap.data();
                    state.userStats = data.stats || {};
                    state.userName = data.name || '';
                }
            },
            saveName: async (e) => {
                e.preventDefault();
                if (!state.user) return;
                const name = $('mypage-name-input').value.trim();
                nav.setLoading(true);
                try {
                    await updateDoc(doc(db, 'users', state.user.uid), { name });
                    state.userName = name;
                    alert("名前を保存しました。");
                } catch (err) {
                    alert("名前の保存に失敗しました。");
                    console.error(err);
                } finally {
                    nav.setLoading(false);
                }
            },
            
            recordQuestionLog: async (qData, resultType, timeSec) => {
                if (!state.user) return;
                try {
                    const logRef = collection(db, 'users', state.user.uid, 'logs');
                    await addDoc(logRef, {
                        questionId: qData.id || '',
                        subject: qData.subject || '',
                        chapter: qData.chapter || '',
                        questionText: qData.q || '',
                        result: resultType, 
                        timeSeconds: timeSec,
                        timestamp: serverTimestamp()
                    });
                } catch (err) {
                    console.error("Log record error:", err);
                }
            },
            
            updateUserStats: async (correct, total, sessionTimeSec, questionTimes) => {
                if (!state.user) return;
                try {
                    const userDocRef = doc(db, 'users', state.user.uid);
                    const snap = await getDoc(userDocRef);
                    const currStats = snap.exists() ? (snap.data().stats || {}) : {};

                    const newTotalAnswered = (currStats.totalAnswered || 0) + total;
                    const newTotalCorrect = (currStats.totalCorrect || 0) + correct;
                    const newTotalTime = (currStats.totalTimeSeconds || 0) + sessionTimeSec;
                    const newSessionCount = (currStats.sessionCount || 0) + 1;

                    
                    let minTime = currStats.minQuestionTime;
                    let maxTime = currStats.maxQuestionTime || 0;

                    questionTimes.forEach(t => {
                        if (minTime === null || minTime === undefined || t < minTime) minTime = t;
                        if (t > maxTime) maxTime = t;
                    });

                    
                    const currentAcc = total > 0 ? Math.round((correct / total) * 100) : 0;
                    let bestAcc = currStats.bestAccuracy || 0;
                    if (currentAcc > bestAcc) bestAcc = currentAcc;

                    let bestTime = currStats.bestSessionTime;
                    if (bestTime === null || bestTime === undefined || sessionTimeSec < bestTime) {
                        bestTime = sessionTimeSec;
                    }

                    await updateDoc(userDocRef, {
                        "stats.totalAnswered": newTotalAnswered,
                        "stats.totalCorrect": newTotalCorrect,
                        "stats.totalTimeSeconds": newTotalTime,
                        "stats.sessionCount": newSessionCount,
                        "stats.minQuestionTime": minTime,
                        "stats.maxQuestionTime": maxTime,
                        "stats.bestAccuracy": bestAcc,
                        "stats.bestSessionTime": bestTime
                    });
                    
                    await dataApp.fetchUserData(state.user.uid);
                } catch (e) { console.error("Stats update error", e); }
            },
            fetchQuestions: async () => {
                try {
                    const qCol = collection(db, 'questions');
                    let qs = (await getDocs(qCol)).docs.map(d => ({ id: d.id, ...d.data() }));

                    if (qs.length === 0) {
                        await dataApp.injectDummyData();
                        qs = (await getDocs(qCol)).docs.map(d => ({ id: d.id, ...d.data() }));
                    }

                    state.questionsDB = qs;
                    const grouped = {};
                    qs.forEach(q => {
                        if (!grouped[q.subject]) grouped[q.subject] = new Set();
                        grouped[q.subject].add(q.chapter);
                    });
                    state.subjects = Object.keys(grouped).map(name => ({ name, chapters: Array.from(grouped[name]).sort() }));
                } catch (e) { alert("データの読み込みに失敗しました。"); }
            },
            injectDummyData: async () => {
                const dummy = [
                    { subject: "地理探求", chapter: "1-1 世界の姿", q: "地球の表面積における海の割合は約何パーセントか。", a: ["70", "71", "70%", "71%"] },
                    { subject: "地理探求", chapter: "1-1 世界の姿", q: "世界で最も面積が大きい国はどこか。", a: ["ロシア", "ロシア連邦"] },
                    { subject: "公共", chapter: "1-1 青年期", q: "マージナル・マン（境界人）という概念を提唱した心理学者は誰か。", a: ["レヴィン", "クルト・レヴィン"] },
                    { subject: "公共", chapter: "1-1 青年期", q: "心理的離乳（親からの自立）を提唱したのは誰か。", a: ["ホリングワース"] }
                ];
                const batch = writeBatch(db);
                dummy.forEach(q => batch.set(doc(collection(db, 'questions')), q));
                await batch.commit();
            }
        };

        const authApp = {
            isLoginMode: true,
            init: () => {
                onAuthStateChanged(auth, async (user) => {
                    nav.setLoading(true);
                    if (user) {
                        state.user = user;
                        await dataApp.ensureUserDoc(user.uid);
                        await dataApp.fetchUserData(user.uid);
                        await dataApp.fetchQuestions();
                        nav.go('home');
                    } else {
                        state.user = null;
                        nav.go('auth');
                    }
                    nav.setLoading(false);
                });
            },
            toggleMode: () => {
                authApp.isLoginMode = !authApp.isLoginMode;
                $('auth-title').innerText = authApp.isLoginMode ? 'LOGIN' : 'SIGN UP';
                $('auth-submit-text').innerText = authApp.isLoginMode ? 'SIGN IN' : 'CREATE ACCOUNT';
                $('auth-toggle-text').innerText = authApp.isLoginMode ? 'Create Account' : 'Back to Login';
                $('auth-error').classList.add('hidden');
            },
            handleSubmit: async (e) => {
                e.preventDefault();
                const email = $('auth-email').value;
                const password = $('auth-password').value;
                const errorEl = $('auth-error');
                
                try {
                    errorEl.classList.add('hidden');
                    nav.setLoading(true);
                    if (authApp.isLoginMode) await signInWithEmailAndPassword(auth, email, password);
                    else await createUserWithEmailAndPassword(auth, email, password);
                } catch (err) {
                    nav.setLoading(false);
                    errorEl.innerText = '認証エラー: 入力内容を確認してください。';
                    errorEl.classList.remove('hidden');
                }
            },
            logout: () => signOut(auth)
        };

        const renderApp = {
            home: () => {
                const list = $('subject-list');
                list.innerHTML = '';
                
                if (state.subjects.length === 0) {
                    $('no-data-msg').classList.remove('hidden');
                    return;
                }
                $('no-data-msg').classList.add('hidden');

                state.subjects.forEach(subj => {
                    const count = state.questionsDB.filter(q => q.subject === subj.name).length;
                    const btn = document.createElement('button');
                    btn.className = 'brutal-btn p-4 md:p-5 text-left flex flex-col justify-between group h-full items-start break-words';
                    btn.onclick = () => { state.currentSubject = subj.name; nav.go('subject'); };
                    btn.innerHTML = `
                        <span class="text-lg md:text-xl font-black mb-4 w-full leading-tight uppercase">${subj.name}</span>
                        <div class="flex justify-between items-center w-full mt-auto">
                            <span class="font-bold border-2 border-black bg-white text-black text-[10px] md:text-xs px-1.5 py-0.5 uppercase">${count} Q</span>
                            <span class="font-black text-lg transition-transform group-hover:translate-x-1.5">&rarr;</span>
                        </div>
                    `;
                    list.appendChild(btn);
                });
            },
            subject: () => {
                if (!state.currentSubject) return;
                $('subject-title').innerText = state.currentSubject;
                
                const subjData = state.subjects.find(s => s.name === state.currentSubject);
                const list = $('chapter-list');
                list.innerHTML = '';

                subjData.chapters.forEach(ch => {
                    const count = state.questionsDB.filter(q => q.subject === state.currentSubject && q.chapter === ch).length;
                    const btn = document.createElement('button');
                    btn.className = 'brutal-btn p-3 md:p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center bg-white gap-2 sm:gap-0';
                    btn.onclick = () => quizApp.start(state.currentSubject, ch);
                    btn.innerHTML = `
                        <span class="font-black text-sm text-left break-words uppercase leading-snug">${ch}</span>
                        <span class="font-bold border-2 border-black px-1.5 py-0.5 text-[10px] md:text-xs whitespace-nowrap uppercase">${count} Q</span>
                    `;
                    list.appendChild(btn);
                });
            },
            mypage: () => {
                const stats = state.userStats || {};
                const totalAnswered = stats.totalAnswered || 0;
                const totalCorrect = stats.totalCorrect || 0;
                const totalTimeSeconds = stats.totalTimeSeconds || 0;

                const accuracy = totalAnswered > 0 ? Math.round((totalCorrect / totalAnswered) * 100) : 0;
                const hours = Math.floor(totalTimeSeconds / 3600);
                const minutes = Math.floor((totalTimeSeconds % 3600) / 60);

                
                $('mypage-email').innerText = state.user?.email || '---';
                $('mypage-name-input').value = state.userName || '';
                $('mypage-avatar').innerText = (state.userName || state.user?.email || '?').charAt(0).toUpperCase();
                
                
                $('mypage-accuracy').innerText = accuracy;
                $('mypage-correct').innerText = totalCorrect;
                $('mypage-answered').innerText = totalAnswered;
                
                $('mypage-minutes').innerText = minutes;
                $('mypage-hours-area').classList.toggle('hidden', hours === 0);
                if (hours > 0) $('mypage-hours').innerText = hours;
                
                $('mypage-sessions').innerText = stats.sessionCount || 0;

                
                const avgSpeed = totalAnswered > 0 ? (totalTimeSeconds / totalAnswered).toFixed(1) : 0;
                const minSpeed = stats.minQuestionTime !== null && stats.minQuestionTime !== undefined ? stats.minQuestionTime.toFixed(1) : 0;
                const maxSpeed = stats.maxQuestionTime ? stats.maxQuestionTime.toFixed(1) : 0;

                $('mypage-speed-avg').innerText = avgSpeed;
                $('mypage-speed-min').innerText = minSpeed;
                $('mypage-speed-max').innerText = maxSpeed;

                
                $('mypage-best-acc').innerText = stats.bestAccuracy || 0;
                
                if (stats.bestSessionTime !== null && stats.bestSessionTime !== undefined) {
                    const bMin = Math.floor(stats.bestSessionTime / 60);
                    const bSec = stats.bestSessionTime % 60;
                    $('mypage-best-time').innerText = `${bMin}m ${bSec}s`;
                } else {
                    $('mypage-best-time').innerText = `0m 0s`;
                }
            }
        };

        const quizApp = {
            start: (subject, chapter) => {
                state.currentSubject = subject;
                state.currentChapter = chapter;
                
                let targetQs = state.questionsDB.filter(q => q.subject === subject);
                if (chapter) targetQs = targetQs.filter(q => q.chapter === chapter);
                if (targetQs.length === 0) return;

                targetQs = targetQs.sort(() => Math.random() - 0.5);

                state.quiz = { 
                    questions: targetQs, 
                    currentIndex: 0, 
                    score: 0, 
                    mistakes: [], 
                    startTime: Date.now(), 
                    durationSec: 0, 
                    isAnswered: false,
                    questionTimes: [], 
                    qStartTime: Date.now()
                };

                $('quiz-subject-name').innerText = subject;
                $('quiz-chapter-name').innerText = chapter || 'ALL';
                $('quiz-total-num').innerText = targetQs.length;
                
                nav.go('quiz');
                quizApp.renderQuestion();
            },
            
            renderQuestion: () => {
                const q = state.quiz;
                q.isAnswered = false;
                q.qStartTime = Date.now(); 
                
                $('quiz-current-num').innerText = q.currentIndex + 1;
                $('quiz-score').innerText = q.score;
                $('quiz-mistakes').innerText = q.mistakes.length;
                
                $('quiz-question-text').innerText = q.questions[q.currentIndex].q;
                
                $('quiz-answer-input').value = '';
                $('quiz-input-area').classList.remove('hidden');
                $('quiz-feedback-area').classList.add('hidden');
                
                setTimeout(() => $('quiz-answer-input').focus(), 50);
            },

            checkStr: (input, answers) => {
                const normalize = (str) => str.toLowerCase().replace(/[\s　]/g, '').replace(/[\u30a1-\u30f6]/g, m => String.fromCharCode(m.charCodeAt(0) - 0x60));
                const normIn = normalize(input);
                return answers.some(a => normalize(a) === normIn);
            },

            submitAnswer: (e) => {
                e.preventDefault();
                if (state.quiz.isAnswered) return;
                
                const input = $('quiz-answer-input').value.trim();
                if (input === '') return;

                state.quiz.isAnswered = true;
                const currentQ = state.quiz.questions[state.quiz.currentIndex];
                const isCorrect = quizApp.checkStr(input, currentQ.a);

                
                const qTimeSec = Math.max(1, Math.round((Date.now() - state.quiz.qStartTime) / 1000));
                state.quiz.questionTimes.push(qTimeSec);

                if (isCorrect) state.quiz.score++;
                else state.quiz.mistakes.push(currentQ);

                
                dataApp.recordQuestionLog(currentQ, isCorrect ? 'correct' : 'wrong', qTimeSec);

                quizApp.showFeedback(isCorrect ? 'correct' : 'wrong', currentQ.a);
            },

            skip: () => {
                if (state.quiz.isAnswered) return;
                const q = state.quiz;
                q.questions.push(q.questions.splice(q.currentIndex, 1)[0]);
                quizApp.renderQuestion();
            },

            giveUp: () => {
                if (state.quiz.isAnswered) return;
                state.quiz.isAnswered = true;
                const currentQ = state.quiz.questions[state.quiz.currentIndex];
                
                const qTimeSec = Math.max(1, Math.round((Date.now() - state.quiz.qStartTime) / 1000));
                state.quiz.questionTimes.push(qTimeSec);

                state.quiz.mistakes.push(currentQ);

                
                dataApp.recordQuestionLog(currentQ, 'giveup', qTimeSec);

                quizApp.showFeedback('giveup', currentQ.a);
            },

            showFeedback: (type, answers) => {
                $('quiz-input-area').classList.add('hidden');
                
                const header = $('quiz-feedback-header');
                if (type === 'correct') {
                    header.innerHTML = `<span class="text-2xl md:text-3xl font-black text-white">O</span><h3 class="text-xl md:text-2xl font-black uppercase tracking-[0.1em] text-white">Correct</h3>`;
                } else if (type === 'wrong') {
                    header.innerHTML = `<span class="text-2xl md:text-3xl font-black text-gray-400">X</span><h3 class="text-xl md:text-2xl font-black uppercase tracking-[0.1em] text-gray-400">Wrong</h3>`;
                } else {
                    header.innerHTML = `<span class="text-2xl md:text-3xl font-black text-gray-400">-</span><h3 class="text-xl md:text-2xl font-black uppercase tracking-[0.1em] text-gray-400">Give Up</h3>`;
                }

                $('quiz-feedback-answer').innerText = answers.join(' / ');
                $('quiz-feedback-area').classList.remove('hidden');
                
                setTimeout(() => $('quiz-next-btn').focus(), 50);
            },

            next: () => {
                const q = state.quiz;
                if (q.currentIndex + 1 < q.questions.length) {
                    q.currentIndex++;
                    quizApp.renderQuestion();
                } else {
                    quizApp.finish();
                }
            },

            finish: () => {
                const q = state.quiz;
                q.durationSec = Math.floor((Date.now() - q.startTime) / 1000);
                
                
                dataApp.updateUserStats(q.score, q.questions.length, q.durationSec, q.questionTimes);
                
                $('result-score').innerText = q.score;
                $('result-total').innerText = q.questions.length;
                $('result-time-m').innerText = Math.floor(q.durationSec / 60);
                $('result-time-s').innerText = q.durationSec % 60;

                const misArea = $('result-mistakes-area');
                const misList = $('result-mistakes-list');
                misList.innerHTML = '';
                
                if (q.mistakes.length > 0) {
                    misArea.classList.remove('hidden');
                    q.mistakes.forEach(mis => {
                        const li = document.createElement('li');
                        li.className = 'border-2 border-black p-3 md:p-4 bg-gray-50';
                        li.innerHTML = `
                            <p class="font-black text-sm md:text-base mb-2.5 break-words">${mis.q}</p>
                            <p class="font-bold text-black text-xs md:text-sm bg-white border-2 border-black inline-block px-1.5 py-0.5"><span class="bg-black text-white px-1.5 py-0.5 mr-1.5 text-[10px] md:text-xs uppercase">Answer</span> ${mis.a[0]}</p>
                        `;
                        misList.appendChild(li);
                    });
                } else {
                    misArea.classList.add('hidden');
                }

                nav.go('result');
            }
        };

        window.nav = nav;
        window.authApp = authApp;
        window.quizApp = quizApp;
        window.dataApp = dataApp;

        window.onload = () => authApp.init();
