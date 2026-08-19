# User Manual
## XYZ AI — School Assistant

This manual covers everyday use of XYZ AI for each of the four account types.
For setup/installation, see `10_Deployment_Guide.md`.

## 1. Signing In

1. Open the app in your browser.
2. Choose your preferred language from the selector in the top corner of the
   login screen (English, Hindi, Tamil, Telugu, Marathi, Bengali, Gujarati,
   Punjabi, Kannada, Malayalam, or Urdu).
3. Enter your email and password, and tap **Sign in** — or, on the demo build,
   tap one of the **demo account chips** (Student / Parent / Teacher /
   Principal) to sign in instantly with a sample account.

You'll land on a dashboard tailored to your role.

## 2. The Dashboard

Every role sees:
- A summary of the attendance information relevant to them (see §3–§6 below).
- A **Chat** panel — type a question to XYZ AI any time.
- A **Live conversation** button next to the chat title — opens a full-screen
  view with XYZ AI's animated avatar, for talking instead of typing.

On a phone or narrow window, navigation moves to a bottom tab bar; on a wider
screen, it's a sidebar. Both show the same information.

## 3. Students — Viewing Your Attendance

Ask XYZ AI things like:
- *"What is my attendance?"*
- *"How many days have I been absent?"*

XYZ AI will reply with your attendance percentage and a present/absent/late
breakdown. Your dashboard also shows this at a glance, along with recent-day
history.

## 4. Parents — Checking on Your Child

### 4.1 Attendance
Ask:
- *"How much attendance does my child have?"*
- *"How is Rahul doing?"* (name a specific child if you have more than one
  linked to your account)

If you have multiple children and don't name one, XYZ AI will ask which child
you mean before answering.

### 4.2 Talking to a Real Teacher or the School Office
If you're not satisfied with an answer, or you just want to speak with a
person, say so:
> *"I am not satisfied. I want to talk to my child's teacher."*

XYZ AI will offer to submit a call request and ask you to confirm:
> *"Of course. I can connect you with the teacher. Would you like me to
> request a call now?"*

Reply **"Yes"** (or tap the **Yes, request it** button) to actually send the
request — you'll get a confirmation message with a reference code. Reply
**"No"** (or tap **No, cancel**) and nothing is sent. XYZ AI will never tell
you a call has been arranged unless you've confirmed it.

To reach the principal's office instead of the teacher, mention "principal,"
"management," or "school admin" in your request.

### 4.3 Tracking contact requests
The **Contact requests** section on your dashboard shows every request you
sent and whether it is **Pending**, **Accepted**, or **Rejected**.

## 5. Teachers — Marking Attendance

### 5.1 Marking a student
Tell XYZ AI, in one message:
> *"Mark Rahul absent today."*
> *"Mark Priya late."*

XYZ AI will confirm: *"Marked Rahul as absent for today."* If you only name a
student without a status (*"Mark Rahul"*), XYZ AI will ask you to pick
Present, Absent, or Late.

You can only mark students in classes assigned to you. If you try to mark a
student from a class you don't teach, XYZ AI will tell you it can't find that
student in your assigned classes.

### 5.2 Checking today's status
Any other message (e.g. *"How's my class doing today?"*) returns a quick
summary: how many students across your class(es) are marked present so far
today.

### 5.3 Dashboard view
Your dashboard lists each of your assigned classes; opening one shows every
student's status for today, and you can mark attendance directly there as
well as through chat.

### 5.4 Contact requests
The **Contact requests** section lists parent requests for students in your
assigned classes. Open requests have **Accept** and **Reject** buttons; once
you respond, the parent can see the updated status.

In an assigned class, select a student's name to see their attendance history.
Use **Contact parent** beside that student to send their parent a contact
request; their response appears in your Contact requests section.

## 6. Principal — School-Wide Analytics

Ask:
- *"What is the overall attendance?"*
- *"How is attendance across the school?"*

XYZ AI reports school-wide attendance percentage over the last 30 days and
total student count. Your dashboard additionally lets you drill into:
- Any individual class's today-status roster.
- Any individual student's attendance history — school-wide, not limited to
  any one class.

Use the **All classes**, **Needs attention**, and **Good performance** filters
to focus on class performance. Within a class, use the matching student
filters, review the responsible teacher, and choose **Contact parent** or
**Contact teacher** beside a student.

The **Contact requests** section contains requests directed to the principal's
office, plus your outgoing requests. Use **Accept** or **Reject** to update an
incoming request's status.

## 7. Using Voice and the Avatar

1. Tap the **Live conversation** button to open the full-screen avatar view.
2. Tap the microphone icon and speak your question naturally.
3. XYZ AI's avatar will respond with a spoken reply, syncing its mouth
   movements to what it's saying, and its expression will shift (e.g.
   brighter for good attendance news, more concerned for a low percentage or
   a raised concern).
4. Close the overlay any time to return to typed chat — the ordinary text chat
   panel never speaks on its own, so voice only ever happens when you've
   opened this view.

**Notes**:
- Voice input (the microphone) works best in Chrome or Edge; on browsers
  without support, you'll see a friendly note and can keep typing instead.
- If the school's local voice model isn't set up yet, replies are still
  spoken aloud using your browser's own built-in voice instead — you may
  notice a difference in voice quality, but nothing stops working.
- You can change your language at any point, including mid-conversation — the
  very next reply (spoken and written) will switch to your new choice.

## 8. Quick-Reply Buttons

Some XYZ AI replies include tappable buttons instead of (or in addition to)
free text — for example, "Yes, request it" / "No, cancel" during an
escalation, or "Present" / "Absent" / "Late" when marking a student. Tapping
one sends that exact response for you; you can always type your own reply
instead.

## 9. Frequently Asked Questions

**Q: Can XYZ AI see information about other students/families?**
No. Parents only ever see their own linked children; teachers only ever see
their own assigned classes. This is enforced by the system itself, not just
by what XYZ AI is willing to say — asking it to bypass this or claim a
different role will not work.

**Q: Does XYZ AI ever mark attendance or contact a teacher without me asking?**
No. Every action (marking attendance, requesting a call) only happens after
you've either given a clear instruction (teachers) or explicitly confirmed
(parents' escalation requests).

**Q: What happens if I ask something outside attendance/school topics, or try
to get XYZ AI to reveal internal system information?**
XYZ AI will politely decline and steer back to what it can help with — school
attendance, escalations, and your own account's information.

**Q: Which languages are supported?**
English, Hindi, Tamil, Telugu, Marathi, Bengali, Gujarati, Punjabi, Kannada,
Malayalam, and Urdu — for typed chat, spoken replies, and (where your browser
supports it) voice input.

## 10. Getting Further Help

If XYZ AI can't resolve your question, or you'd simply rather speak with a
person:
- **Parents**: ask XYZ AI to connect you with your child's teacher or the
  school office (§4.2).
- **Students, teachers, principals**: contact your school through its usual
  channels — the escalation flow above is currently available to the parent
  role, matching the escalation use case in the product's design.
