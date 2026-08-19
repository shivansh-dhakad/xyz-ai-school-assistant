// Supported languages: code -> { label, voiceLocale (for speech APIs) }
const LANGUAGES = {
  en: { label: "English", voice: "en-IN" },
  hi: { label: "हिन्दी", voice: "hi-IN" },
  ta: { label: "தமிழ்", voice: "ta-IN" },
  te: { label: "తెలుగు", voice: "te-IN" },
  mr: { label: "मराठी", voice: "mr-IN" },
  bn: { label: "বাংলা", voice: "bn-IN" },
  gu: { label: "ગુજરાતી", voice: "gu-IN" },
  pa: { label: "ਪੰਜਾਬੀ", voice: "pa-IN" },
  kn: { label: "ಕನ್ನಡ", voice: "kn-IN" },
  ml: { label: "മലയാളം", voice: "ml-IN" },
  ur: { label: "اردو", voice: "ur-IN" },
};

// UI string dictionary. English is the complete/authoritative set;
// other languages cover the same keys (falls back to English if a key
// is missing for a given language).
const I18N = {
  en: {
    appName: "XYZ AI", appTagline: "Your school, one conversation away",
    email: "Email", password: "Password", signIn: "Sign in", signOut: "Sign out",
    tryDemo: "Try a demo account", home: "Home", chat: "Chat", profile: "Profile",
    preferences: "Preferences", language: "Language", voiceReplies: "Speak replies aloud",
    typeMessage: "Type a message…", tapMicHint: "Tap the mic and speak",
    listening: "Listening…", thinking: "Thinking…", speaking: "Speaking…",
    myAttendance: "My attendance", recentDays: "Recent days",
    myChildren: "My children", requestTeacherCall: "Call teacher", requestManagementCall: "Call principal",
    myClasses: "My classes", markAttendance: "Mark attendance", today: "Today",
    schoolOverview: "School overview", overallAttendance: "Overall attendance", totalStudents: "Total students",
    byClass: "By class", present: "Present", absent: "Absent", late: "Late", unmarked: "Unmarked",
    requestSent: "Request sent", markedDone: "Marked",
    micNotSupported: "Voice input isn't supported in this browser.",
    roleStudent: "Student", roleParent: "Parent", roleTeacher: "Teacher", rolePrincipal: "Principal",
    heroPoint1: "Chat, voice or avatar — however you'd rather talk",
    heroPoint2: "Built for students, parents, teachers and principals",
    heroPoint3: "Escalate to a real teacher whenever you need one",
    contactPrincipal: "Contact principal", absentDays: "Absent days",
    viewAttendance: "View attendance", back: "Back", bySection: "By section", byGrade: "By grade",
    liveConversation: "Live conversation", liveConversationOn: "Live — tap to stop",
    liveConversationHint: "I'll keep listening after each reply until you stop.",
    studentWise: "Student-wise", noAbsences: "No absences in this period",
    wrongPortal: "This account isn't for this portal — please use the right app for your role.",
  },
  hi: {
    appName: "XYZ AI", appTagline: "आपका स्कूल, एक बातचीत की दूरी पर",
    email: "ईमेल", password: "पासवर्ड", signIn: "साइन इन करें", signOut: "साइन आउट करें",
    tryDemo: "डेमो खाता आज़माएं", home: "होम", chat: "चैट", profile: "प्रोफ़ाइल",
    preferences: "प्राथमिकताएं", language: "भाषा", voiceReplies: "जवाब बोलकर सुनाएं",
    typeMessage: "संदेश लिखें…", tapMicHint: "माइक दबाएं और बोलें",
    listening: "सुन रहा हूँ…", thinking: "सोच रहा हूँ…", speaking: "बोल रहा हूँ…",
    myAttendance: "मेरी उपस्थिति", recentDays: "हाल के दिन",
    myChildren: "मेरे बच्चे", requestTeacherCall: "शिक्षक को कॉल करें", requestManagementCall: "प्रधानाचार्य को कॉल करें",
    myClasses: "मेरी कक्षाएं", markAttendance: "उपस्थिति दर्ज करें", today: "आज",
    schoolOverview: "स्कूल का अवलोकन", overallAttendance: "कुल उपस्थिति", totalStudents: "कुल छात्र",
    byClass: "कक्षा अनुसार", present: "उपस्थित", absent: "अनुपस्थित", late: "देर से", unmarked: "अचिह्नित",
    requestSent: "अनुरोध भेजा गया", markedDone: "दर्ज किया गया",
    micNotSupported: "इस ब्राउज़र में वॉइस इनपुट समर्थित नहीं है।",
    roleStudent: "छात्र", roleParent: "अभिभावक", roleTeacher: "शिक्षक", rolePrincipal: "प्रधानाचार्य",
    heroPoint1: "चैट, आवाज़ या अवतार — जैसे आप बात करना चाहें",
    heroPoint2: "छात्रों, अभिभावकों, शिक्षकों और प्रधानाचार्य के लिए बनाया गया",
    heroPoint3: "जब भी ज़रूरत हो, असली शिक्षक से जुड़ें",
    contactPrincipal: "प्रधानाचार्य से संपर्क करें", absentDays: "अनुपस्थित दिन",
    viewAttendance: "उपस्थिति देखें", back: "वापस", bySection: "सेक्शन अनुसार", byGrade: "कक्षा-स्तर अनुसार",
    liveConversation: "लाइव बातचीत", liveConversationOn: "लाइव — रोकने के लिए टैप करें",
    liveConversationHint: "जब तक आप रोकेंगे नहीं, मैं हर जवाब के बाद सुनता रहूँगा।",
    studentWise: "छात्र अनुसार", noAbsences: "इस अवधि में कोई अनुपस्थिति नहीं",
    wrongPortal: "यह खाता इस पोर्टल के लिए नहीं है — कृपया अपनी भूमिका के लिए सही ऐप का उपयोग करें।",
  },
  ta: {
    email: "மின்னஞ்சல்", password: "கடவுச்சொல்", signIn: "உள்நுழைக",
    home: "முகப்பு", chat: "அரட்டை", profile: "சுயவிவரம்",
    typeMessage: "செய்தியை உள்ளிடவும்…", myAttendance: "எனது வருகை",
    present: "வருகை", absent: "வராதவர்", late: "தாமதம்",
  },
  te: {
    email: "ఇమెయిల్", password: "పాస్‌వర్డ్", signIn: "సైన్ ఇన్ చేయండి",
    home: "హోమ్", chat: "చాట్", profile: "ప్రొఫైల్",
    typeMessage: "సందేశం టైప్ చేయండి…", myAttendance: "నా హాజరు",
    present: "హాజరు", absent: "గైర్హాజరు", late: "ఆలస్యం",
  },
  mr: {
    email: "ईमेल", password: "पासवर्ड", signIn: "साइन इन करा",
    home: "मुख्यपृष्ठ", chat: "गप्पा", profile: "प्रोफाइल",
    typeMessage: "संदेश टाइप करा…", myAttendance: "माझी उपस्थिती",
    present: "उपस्थित", absent: "अनुपस्थित", late: "उशीरा",
  },
  bn: {
    email: "ইমেইল", password: "পাসওয়ার্ড", signIn: "সাইন ইন করুন",
    home: "হোম", chat: "চ্যাট", profile: "প্রোফাইল",
    typeMessage: "বার্তা লিখুন…", myAttendance: "আমার উপস্থিতি",
    present: "উপস্থিত", absent: "অনুপস্থিত", late: "দেরিতে",
  },
  gu: {
    email: "ઇમેઇલ", password: "પાસવર્ડ", signIn: "સાઇન ઇન કરો",
    home: "હોમ", chat: "ચેટ", profile: "પ્રોફાઇલ",
    typeMessage: "સંદેશ લખો…", myAttendance: "મારી હાજરી",
    present: "હાજર", absent: "ગેરહાજર", late: "મોડું",
  },
  pa: {
    email: "ਈਮੇਲ", password: "ਪਾਸਵਰਡ", signIn: "ਸਾਈਨ ਇਨ ਕਰੋ",
    home: "ਹੋਮ", chat: "ਚੈਟ", profile: "ਪ੍ਰੋਫਾਈਲ",
    typeMessage: "ਸੁਨੇਹਾ ਲਿਖੋ…", myAttendance: "ਮੇਰੀ ਹਾਜ਼ਰੀ",
    present: "ਹਾਜ਼ਰ", absent: "ਗੈਰਹਾਜ਼ਰ", late: "ਦੇਰ ਨਾਲ",
  },
  kn: {
    email: "ಇಮೇಲ್", password: "ಪಾಸ್‌ವರ್ಡ್", signIn: "ಸೈನ್ ಇನ್ ಮಾಡಿ",
    home: "ಮುಖಪುಟ", chat: "ಚಾಟ್", profile: "ಪ್ರೊಫೈಲ್",
    typeMessage: "ಸಂದೇಶ ಟೈಪ್ ಮಾಡಿ…", myAttendance: "ನನ್ನ ಹಾಜರಾತಿ",
    present: "ಹಾಜರು", absent: "ಗೈರುಹಾಜರು", late: "ತಡ",
  },
  ml: {
    email: "ഇമെയിൽ", password: "പാസ്‌വേഡ്", signIn: "സൈൻ ഇൻ ചെയ്യുക",
    home: "ഹോം", chat: "ചാറ്റ്", profile: "പ്രൊഫൈൽ",
    typeMessage: "സന്ദേശം ടൈപ്പ് ചെയ്യുക…", myAttendance: "എന്റെ ഹാജർ",
    present: "ഹാജർ", absent: "ഹാജരല്ല", late: "വൈകി",
  },
  ur: {
    email: "ای میل", password: "پاس ورڈ", signIn: "سائن ان کریں",
    home: "ہوم", chat: "چیٹ", profile: "پروفائل",
    typeMessage: "پیغام لکھیں…", myAttendance: "میری حاضری",
    present: "حاضر", absent: "غیر حاضر", late: "دیر سے",
  },
};

function t(key, lang) {
  const l = I18N[lang] || {};
  return l[key] || I18N.en[key] || key;
}