    const TRANSCRIPTEUR_ID = '__transcripteur__';
    const TRADUCTEUR_ID = '__traducteur__';

    // Drapeaux partagés par code de langue. Décoratifs uniquement
    // (accessibilité daltonisme : le nom reste la source fiable). Absents pour
    // les langues sans pays de référence (basque, catalan, galicien…).
    const LANG_FLAGS = {
        af:'🇿🇦', ak:'🇬🇭', sq:'🇦🇱', de:'🇩🇪', am:'🇪🇹', en:'🇬🇧', ar:'🇸🇦', hy:'🇦🇲', az:'🇦🇿',
        bn:'🇧🇩', be:'🇧🇾', my:'🇲🇲', bg:'🇧🇬', zh:'🇨🇳', 'zh-Hans':'🇨🇳', 'zh-Hant':'🇹🇼', ko:'🇰🇷',
        hr:'🇭🇷', da:'🇩🇰', es:'🇪🇸', et:'🇪🇪', fil:'🇵🇭', fi:'🇫🇮', fr:'🇫🇷', ka:'🇬🇪', el:'🇬🇷',
        gu:'🇮🇳', he:'🇮🇱', hi:'🇮🇳', hu:'🇭🇺', id:'🇮🇩', is:'🇮🇸', it:'🇮🇹', ja:'🇯🇵', jv:'🇮🇩',
        kn:'🇮🇳', kk:'🇰🇿', km:'🇰🇭', rw:'🇷🇼', lo:'🇱🇦', lv:'🇱🇻', lt:'🇱🇹', mk:'🇲🇰', ms:'🇲🇾',
        ml:'🇮🇳', mr:'🇮🇳', mn:'🇲🇳', nl:'🇳🇱', ne:'🇳🇵', no:'🇳🇴', ur:'🇵🇰', uz:'🇺🇿', pa:'🇮🇳',
        fa:'🇮🇷', pl:'🇵🇱', pt:'🇵🇹', 'pt-BR':'🇧🇷', 'pt-PT':'🇵🇹', ro:'🇷🇴', ru:'🇷🇺', sr:'🇷🇸',
        sd:'🇵🇰', si:'🇱🇰', sk:'🇸🇰', sl:'🇸🇮', su:'🇮🇩', sv:'🇸🇪', sw:'🇰🇪', ta:'🇮🇳', cs:'🇨🇿',
        te:'🇮🇳', th:'🇹🇭', tr:'🇹🇷', uk:'🇺🇦', vi:'🇻🇳', zu:'🇿🇦', ha:'🇳🇬'
    };
    function langFlag(code) { return LANG_FLAGS[code] || ''; }

    // Langues cibles supportées par OpenAI (gpt-realtime-translate). Triées en français.
    const TRANSLATE_LANGS_OPENAI = [
        { code: 'de', name: 'Allemand' },   { code: 'en', name: 'Anglais' },
        { code: 'zh', name: 'Chinois' },    { code: 'ko', name: 'Coréen' },
        { code: 'es', name: 'Espagnol' },   { code: 'fr', name: 'Français' },
        { code: 'hi', name: 'Hindi' },      { code: 'id', name: 'Indonésien' },
        { code: 'it', name: 'Italien' },    { code: 'ja', name: 'Japonais' },
        { code: 'pt', name: 'Portugais' },  { code: 'ru', name: 'Russe' },
        { code: 'vi', name: 'Vietnamien' }
    ];

    // Langues cibles supportées par Gemini Live Translate (codes BCP-47 exacts
    // de la doc). Triées alphabétiquement en français.
    const TRANSLATE_LANGS_GEMINI = [
        { code: 'af',      name: 'Afrikaans' },              { code: 'ak',      name: 'Akan' },
        { code: 'sq',      name: 'Albanais' },               { code: 'de',      name: 'Allemand' },
        { code: 'am',      name: 'Amharique' },              { code: 'en',      name: 'Anglais' },
        { code: 'ar',      name: 'Arabe' },                  { code: 'hy',      name: 'Arménien' },
        { code: 'az',      name: 'Azéri' },                  { code: 'eu',      name: 'Basque' },
        { code: 'bn',      name: 'Bengali' },                { code: 'be',      name: 'Biélorusse' },
        { code: 'my',      name: 'Birman' },                 { code: 'bg',      name: 'Bulgare' },
        { code: 'ca',      name: 'Catalan' },                { code: 'zh-Hans', name: 'Chinois (simplifié)' },
        { code: 'zh-Hant', name: 'Chinois (traditionnel)' },{ code: 'ko',      name: 'Coréen' },
        { code: 'hr',      name: 'Croate' },                 { code: 'da',      name: 'Danois' },
        { code: 'es',      name: 'Espagnol' },               { code: 'et',      name: 'Estonien' },
        { code: 'fil',     name: 'Filipino' },               { code: 'fi',      name: 'Finnois' },
        { code: 'fr',      name: 'Français' },               { code: 'gl',      name: 'Galicien' },
        { code: 'ka',      name: 'Géorgien' },               { code: 'el',      name: 'Grec' },
        { code: 'gu',      name: 'Gujarati' },               { code: 'ha',      name: 'Haoussa' },
        { code: 'he',      name: 'Hébreu' },                 { code: 'hi',      name: 'Hindi' },
        { code: 'hu',      name: 'Hongrois' },               { code: 'id',      name: 'Indonésien' },
        { code: 'is',      name: 'Islandais' },              { code: 'it',      name: 'Italien' },
        { code: 'ja',      name: 'Japonais' },               { code: 'jv',      name: 'Javanais' },
        { code: 'kn',      name: 'Kannada' },                { code: 'kk',      name: 'Kazakh' },
        { code: 'km',      name: 'Khmer' },                  { code: 'rw',      name: 'Kinyarwanda' },
        { code: 'lo',      name: 'Laotien' },                { code: 'lv',      name: 'Letton' },
        { code: 'lt',      name: 'Lituanien' },              { code: 'mk',      name: 'Macédonien' },
        { code: 'ms',      name: 'Malais' },                 { code: 'ml',      name: 'Malayalam' },
        { code: 'mr',      name: 'Marathi' },                { code: 'mn',      name: 'Mongol' },
        { code: 'nl',      name: 'Néerlandais' },            { code: 'ne',      name: 'Népalais' },
        { code: 'no',      name: 'Norvégien' },              { code: 'ur',      name: 'Ourdou' },
        { code: 'uz',      name: 'Ouzbek' },                 { code: 'pa',      name: 'Pendjabi' },
        { code: 'fa',      name: 'Persan' },                 { code: 'pl',      name: 'Polonais' },
        { code: 'pt-BR',   name: 'Portugais (Brésil)' },     { code: 'pt-PT',   name: 'Portugais (Portugal)' },
        { code: 'ro',      name: 'Roumain' },                { code: 'ru',      name: 'Russe' },
        { code: 'sr',      name: 'Serbe' },                  { code: 'sd',      name: 'Sindhi' },
        { code: 'si',      name: 'Singhalais' },             { code: 'sk',      name: 'Slovaque' },
        { code: 'sl',      name: 'Slovène' },                { code: 'su',      name: 'Soundanais' },
        { code: 'sv',      name: 'Suédois' },                { code: 'sw',      name: 'Swahili' },
        { code: 'ta',      name: 'Tamoul' },                 { code: 'cs',      name: 'Tchèque' },
        { code: 'te',      name: 'Télougou' },               { code: 'th',      name: 'Thaï' },
        { code: 'tr',      name: 'Turc' },                   { code: 'uk',      name: 'Ukrainien' },
        { code: 'vi',      name: 'Vietnamien' },             { code: 'zu',      name: 'Zoulou' }
    ];

    // Moteurs de traduction disponibles pour le mode Traducteur. OpenAI utilise
    // l'endpoint /realtime/translations ; Gemini le modèle Live Translate.
    const TRANSLATE_MODELS = [
        { key: 'openai', name: 'OpenAI', model: 'gpt-realtime-translate',            provider: 'openai' },
        { key: 'gemini', name: 'Gemini', model: 'gemini-3.5-live-translate-preview', provider: 'gemini' }
    ];
    // La clé API du fournisseur d'un moteur (Traducteur / Transcripteur) est-elle renseignée ?
    function engineHasKey(m) {
        return m.provider === 'gemini' ? !!getGeminiApiKey()
             : m.provider === 'xai'    ? !!getXaiApiKey()
             : !!getApiKey();
    }
    function getTranslateModel() {
        const saved = localStorage.getItem('vart_translateModel') || 'openai';
        const info = TRANSLATE_MODELS.find(m => m.key === saved) || TRANSLATE_MODELS[0];
        if (engineHasKey(info)) return info.key;
        // Clé du moteur choisi absente (ex. une seule clé configurée) → premier
        // moteur utilisable, sinon on garde le choix (le démarrage demandera la clé).
        const usable = TRANSLATE_MODELS.find(engineHasKey);
        return usable ? usable.key : info.key;
    }
    function setTranslateModel(k) { localStorage.setItem('vart_translateModel', k); }
    function translateModelInfo(key) {
        return TRANSLATE_MODELS.find(m => m.key === key) || TRANSLATE_MODELS[0];
    }

    // Moteurs de transcription disponibles pour le mode Transcripteur. OpenAI
    // passe par une session Realtime « transcription » (gpt-realtime-whisper) ;
    // Gemini par la Live API en sortie texte (gemini-3.5-transcribe-live).
    const TRANSCRIBE_MODELS = [
        { key: 'openai', name: 'OpenAI', label: 'OpenAI Whisper Realtime',  model: 'gpt-realtime-whisper',       provider: 'openai' },
        { key: 'gemini', name: 'Gemini', label: 'Gemini 3.5 Transcribe',    model: 'gemini-3.5-transcribe-live', provider: 'gemini' }
    ];
    function transcribeEngineHasKey(m) { return engineHasKey(m); }
    function getTranscribeModel() {
        const saved = localStorage.getItem('vart_transcribeModel') || 'openai';
        const info = transcribeModelInfo(saved);
        if (transcribeEngineHasKey(info)) return info.key;
        // Clé du moteur choisi absente → premier moteur utilisable (sinon on
        // garde le choix tel quel, le démarrage demandera la clé).
        const usable = TRANSCRIBE_MODELS.find(transcribeEngineHasKey);
        return usable ? usable.key : info.key;
    }
    function setTranscribeModel(k) { localStorage.setItem('vart_transcribeModel', k); }
    function transcribeModelInfo(key) {
        return TRANSCRIBE_MODELS.find(m => m.key === key) || TRANSCRIBE_MODELS[0];
    }

    // Langues du Transcripteur — une liste COMPLÈTE par moteur.
    //  - OpenAI (gpt-realtime-whisper) : codes ISO 639-1 → paramètre `language`.
    //    OpenAI ne publie pas de liste propre à ce modèle ; on reprend la liste
    //    documentée de Whisper (57 langues).
    //  - Gemini (gemini-3.5-transcribe-live) : locales BCP-47 exactes de la doc
    //    (85 entrées) → `languageCodes`.
    // « auto » = détection automatique (paramètre omis / liste vide).
    // `base` = langue de base (ISO 639-1) qui relie les deux listes : choisir
    // « Anglais » chez OpenAI présélectionne « Anglais (États-Unis) » chez
    // Gemini, et inversement. Par défaut : base = code avant le premier tiret.
    // Français par défaut : la détection automatique de Gemini est moins
    // fiable qu'une langue fixée.
    const TRANSCRIBE_LANGS_OPENAI = [
        { code: 'auto', name: 'Automatique' },
        { code: 'af', name: 'Afrikaans' },        { code: 'de', name: 'Allemand' },
        { code: 'en', name: 'Anglais' },          { code: 'ar', name: 'Arabe' },
        { code: 'hy', name: 'Arménien' },         { code: 'az', name: 'Azéri' },
        { code: 'be', name: 'Biélorusse' },       { code: 'bs', name: 'Bosniaque', flag: '🇧🇦' },
        { code: 'bg', name: 'Bulgare' },          { code: 'ca', name: 'Catalan', flag: '🇦🇩' },
        { code: 'zh', name: 'Chinois' },          { code: 'ko', name: 'Coréen' },
        { code: 'hr', name: 'Croate' },           { code: 'da', name: 'Danois' },
        { code: 'es', name: 'Espagnol' },         { code: 'et', name: 'Estonien' },
        { code: 'fi', name: 'Finnois' },          { code: 'fr', name: 'Français' },
        { code: 'cy', name: 'Gallois', flag: '🇬🇧' }, { code: 'gl', name: 'Galicien', flag: '🇪🇸' },
        { code: 'el', name: 'Grec' },             { code: 'he', name: 'Hébreu' },
        { code: 'hi', name: 'Hindi' },            { code: 'hu', name: 'Hongrois' },
        { code: 'id', name: 'Indonésien' },       { code: 'is', name: 'Islandais' },
        { code: 'it', name: 'Italien' },          { code: 'ja', name: 'Japonais' },
        { code: 'kn', name: 'Kannada' },          { code: 'kk', name: 'Kazakh' },
        { code: 'lv', name: 'Letton' },           { code: 'lt', name: 'Lituanien' },
        { code: 'mk', name: 'Macédonien' },       { code: 'ms', name: 'Malais' },
        { code: 'mi', name: 'Maori', flag: '🇳🇿' }, { code: 'mr', name: 'Marathi' },
        { code: 'nl', name: 'Néerlandais' },      { code: 'ne', name: 'Népalais' },
        { code: 'no', name: 'Norvégien' },        { code: 'ur', name: 'Ourdou' },
        { code: 'fa', name: 'Persan' },           { code: 'pl', name: 'Polonais' },
        { code: 'pt', name: 'Portugais' },        { code: 'ro', name: 'Roumain' },
        { code: 'ru', name: 'Russe' },            { code: 'sr', name: 'Serbe' },
        { code: 'sk', name: 'Slovaque' },         { code: 'sl', name: 'Slovène' },
        { code: 'sv', name: 'Suédois' },          { code: 'sw', name: 'Swahili' },
        { code: 'tl', name: 'Tagalog', flag: '🇵🇭' }, { code: 'ta', name: 'Tamoul' },
        { code: 'cs', name: 'Tchèque' },          { code: 'th', name: 'Thaï' },
        { code: 'tr', name: 'Turc' },             { code: 'uk', name: 'Ukrainien' },
        { code: 'vi', name: 'Vietnamien' }
    ];
    const TRANSCRIBE_LANGS_GEMINI = [
        { code: 'auto',        name: 'Automatique' },
        { code: 'af-ZA',       name: 'Afrikaans' },
        { code: 'de-DE',       name: 'Allemand' },
        { code: 'am-ET',       name: 'Amharique' },
        { code: 'en-US',       name: 'Anglais (États-Unis)', flag: '🇺🇸' },
        { code: 'en-IN',       name: 'Anglais (Inde)', flag: '🇮🇳' },
        { code: 'en-GB',       name: 'Anglais (Royaume-Uni)', flag: '🇬🇧' },
        { code: 'ar-EG',       name: 'Arabe (Égypte)', flag: '🇪🇬' },
        { code: 'hy-AM',       name: 'Arménien' },
        { code: 'rup-BG',      name: 'Aroumain', flag: '🇧🇬' },
        { code: 'as-IN',       name: 'Assamais', flag: '🇮🇳' },
        { code: 'az-AZ',       name: 'Azéri' },
        { code: 'bn-BD',       name: 'Bengali (Bangladesh)', flag: '🇧🇩' },
        { code: 'bn-IN',       name: 'Bengali (Inde)', flag: '🇮🇳' },
        { code: 'be-BY',       name: 'Biélorusse' },
        { code: 'my-MM',       name: 'Birman' },
        { code: 'bs-BA',       name: 'Bosniaque', flag: '🇧🇦' },
        { code: 'bg-BG',       name: 'Bulgare' },
        { code: 'yue-Hant-HK', name: 'Cantonais (traditionnel)', flag: '🇭🇰' },
        { code: 'kea-CV',      name: 'Capverdien', flag: '🇨🇻' },
        { code: 'ca-ES',       name: 'Catalan', flag: '🇦🇩' },
        { code: 'ceb',         name: 'Cebuano', flag: '🇵🇭' },
        { code: 'cmn-Hans-CN', name: 'Chinois mandarin (simplifié)', base: 'zh', flag: '🇨🇳' },
        { code: 'ko-KR',       name: 'Coréen' },
        { code: 'hr-HR',       name: 'Croate' },
        { code: 'da-DK',       name: 'Danois' },
        { code: 'es-419',      name: 'Espagnol (Amérique latine)', flag: '🇲🇽' },
        { code: 'es-US',       name: 'Espagnol (États-Unis)', flag: '🇺🇸' },
        { code: 'et-EE',       name: 'Estonien' },
        { code: 'fil-PH',      name: 'Filipino', base: 'tl', flag: '🇵🇭' },
        { code: 'fi-FI',       name: 'Finnois' },
        { code: 'fr-FR',       name: 'Français' },
        { code: 'gl-ES',       name: 'Galicien', flag: '🇪🇸' },
        { code: 'ka-GE',       name: 'Géorgien' },
        { code: 'el-GR',       name: 'Grec' },
        { code: 'gu-IN',       name: 'Gujarati' },
        { code: 'ha-NG',       name: 'Haoussa' },
        { code: 'he-IL',       name: 'Hébreu' },
        { code: 'hi-IN',       name: 'Hindi' },
        { code: 'hu-HU',       name: 'Hongrois' },
        { code: 'id-ID',       name: 'Indonésien' },
        { code: 'is-IS',       name: 'Islandais' },
        { code: 'it-IT',       name: 'Italien' },
        { code: 'ja-JP',       name: 'Japonais' },
        { code: 'jv-ID',       name: 'Javanais' },
        { code: 'kn-IN',       name: 'Kannada' },
        { code: 'kk-KZ',       name: 'Kazakh' },
        { code: 'km-KH',       name: 'Khmer' },
        { code: 'ky-KG',       name: 'Kirghize', flag: '🇰🇬' },
        { code: 'lv-LV',       name: 'Letton' },
        { code: 'ln-CD',       name: 'Lingala', flag: '🇨🇩' },
        { code: 'lt-LT',       name: 'Lituanien' },
        { code: 'mk-MK',       name: 'Macédonien' },
        { code: 'ms-MY',       name: 'Malais' },
        { code: 'ml-IN',       name: 'Malayalam' },
        { code: 'mt-MT',       name: 'Maltais', flag: '🇲🇹' },
        { code: 'mr-IN',       name: 'Marathi' },
        { code: 'mn-MN',       name: 'Mongol' },
        { code: 'nl-NL',       name: 'Néerlandais' },
        { code: 'ne-NP',       name: 'Népalais' },
        { code: 'nb-NO',       name: 'Norvégien', base: 'no', flag: '🇳🇴' },
        { code: 'or-IN',       name: 'Odia', flag: '🇮🇳' },
        { code: 'uz-UZ',       name: 'Ouzbek' },
        { code: 'pa-IN',       name: 'Pendjabi' },
        { code: 'pa-Guru-IN',  name: 'Pendjabi (gurmukhi)', flag: '🇮🇳' },
        { code: 'fa-IR',       name: 'Persan' },
        { code: 'pl-PL',       name: 'Polonais' },
        { code: 'pt-BR',       name: 'Portugais (Brésil)', flag: '🇧🇷' },
        { code: 'pt-PT',       name: 'Portugais (Portugal)', flag: '🇵🇹' },
        { code: 'ro-RO',       name: 'Roumain' },
        { code: 'ru-RU',       name: 'Russe' },
        { code: 'sr-RS',       name: 'Serbe' },
        { code: 'sd-Arab-IN',  name: 'Sindhi', flag: '🇮🇳' },
        { code: 'sk-SK',       name: 'Slovaque' },
        { code: 'sl-SI',       name: 'Slovène' },
        { code: 'sv-SE',       name: 'Suédois' },
        { code: 'sw-KE',       name: 'Swahili', flag: '🇰🇪' },
        { code: 'tg-TJ',       name: 'Tadjik', flag: '🇹🇯' },
        { code: 'cs-CZ',       name: 'Tchèque' },
        { code: 'te-IN',       name: 'Télougou' },
        { code: 'th-TH',       name: 'Thaï' },
        { code: 'tr-TR',       name: 'Turc' },
        { code: 'uk-UA',       name: 'Ukrainien' },
        { code: 'vi-VN',       name: 'Vietnamien' }
    ];
    function transcribeLangsFor(engine) {
        return (engine || getTranscribeModel()) === 'gemini' ? TRANSCRIBE_LANGS_GEMINI : TRANSCRIBE_LANGS_OPENAI;
    }
    function transcribeLangBase(entry) { return entry.base || entry.code.split('-')[0]; }
    function transcribeLangInfo(code, engine) {
        const list = transcribeLangsFor(engine);
        return list.find(l => l.code === code) || list[0];
    }
    // Langue active pour un moteur. Priorité : le choix exact fait sur ce
    // moteur s'il correspond encore à la langue de base courante ; sinon la
    // première entrée de même base (lien OpenAI ↔ Gemini) ; sinon, la langue
    // n'existe pas chez ce moteur → « Automatique ». (Sans rien de mémorisé,
    // la base vaut « fr », présente dans les deux listes → Français.)
    function getTranscribeLang(engine) {
        engine = engine || getTranscribeModel();
        const list = transcribeLangsFor(engine);
        const base = localStorage.getItem('vart_transcribeLangBase') || 'fr';
        const own = localStorage.getItem('vart_transcribeLang_' + engine);
        const ownEntry = own && list.find(l => l.code === own);
        if (ownEntry && transcribeLangBase(ownEntry) === base) return ownEntry.code;
        const byBase = list.find(l => transcribeLangBase(l) === base);
        if (byBase) return byBase.code;
        return 'auto';
    }
    function setTranscribeLang(code, engine) {
        engine = engine || getTranscribeModel();
        localStorage.setItem('vart_transcribeLang_' + engine, code);
        localStorage.setItem('vart_transcribeLangBase', transcribeLangBase(transcribeLangInfo(code, engine)));
    }
    // Drapeau : celui de l'entrée si précisé, sinon celui du code, sinon de la
    // langue de base ; globe pour « Automatique ».
    function transcribeLangFlag(code) {
        if (code === 'auto') return '🌐';
        const entry = TRANSCRIBE_LANGS_GEMINI.find(l => l.code === code) || TRANSCRIBE_LANGS_OPENAI.find(l => l.code === code);
        if (!entry) return langFlag(code);
        return entry.flag || langFlag(entry.code) || langFlag(transcribeLangBase(entry));
    }

    // ── Info-bulle de coût (chips / onglets moteur) — affichage instantané ──
