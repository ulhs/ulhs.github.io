# Upper Labay High School Official Website

Welcome to the official website for **Upper Labay High School**. This project is dedicated to providing students, parents, and the community with access to school information, academic programs, and the rich cultural heritage of the **Blaan** people.

## 🌟 Key Features

### Public Features
- **Academic Hub**: Detailed information for Junior and Senior High School programs.
- **Blaan Heritage**: Integration of the School of Living Traditions (SLT) focusing on traditional beadwork.
- **Interactive Dictionary**: A searchable Blaan language dictionary with audio pronunciations.
- **School Calendar**: Live-sync with the school's Google Calendar.
- **Enrollment Center**: Digital access to enrollment forms and requirements.
- **Transparency Board**: Easy access to official school reports and documents.
- **Privacy Policy**: Complete transparency about data handling in compliance with RA 10173 (Data Privacy Act of 2012).

### Parent Portal Features
- **Secure Messenger Registration**: Parent account linking is completed through the official ULHS registration flow, with secure confirmation codes and token validation instead of accepting raw LRN messages. Registration is only completed after the secure Messenger confirmation code is verified, and multiple guardians can link independently to the same child.
- **Secure Login**: PIN-based authentication with rate limiting and encrypted session storage.
- **Student Selector**: Switch between multiple linked children with student photos.
- **Grades Viewing**: Access term grades with color-coded performance indicators.
- **Attendance History**: View detailed attendance logs.
- **Achievements Tracking**: See student awards and recognitions.
- **Secure Photo Access**: Student photos are served via time-limited signed URLs using a dedicated Edge Function for enhanced privacy and security.

### Admin/Personnel Features
- **Attendance Scanner**: Real‑time attendance tracking with QR code scanning.
- **Parent Messenger Alerts**: Automated Facebook Messenger notifications for student attendance.
- **SF2 & SF4 Exports**: Official DepEd School Forms 2 and 4 report generation.
- **Student ID Generator**: Digital student ID card creation with photo capture and QR codes.
- **Role‑Based Access**: Secure authentication with Google OAuth and Role‑Based Access Control (RBAC).
- **Hybrid Offline Support**: Works offline with local IndexedDB storage and syncs automatically when online.
- **Grades Encoding**: Full-featured grade management system with edit/delete capabilities.
- **Achievements Management**: Add and track student awards and achievements.
- **SARDO Risk Dashboard**: Student At-Risk Dropout monitoring system with attendance-based risk scores, Critical/High/Medium/Low summaries, student filtering, assessment progress tracking, triggering factors, and recommended interventions.
- **Access Control**: Manage personnel permissions and roles.

### SARDO Operations
- **Dashboard**: Authorized administrators, school heads, and guidance counselors can review student risk assessments and record interventions.
- **Attendance Data Quality**: Attendance correction and duplicate-review pages support validation of the data used for risk scoring.
- **Assessment Configuration**: Authorized staff can manage SARDO assessment settings and review the previous assessment history for each student.
- **Calendar Validation**: Import school-day, holiday, examination, special-schedule, and suspended-day rows before they are used in risk calculations.
- **Pilot Review**: Record verified risk levels, intervention outcomes, and notes for calibration and monitoring.
- **Follow-up Alerts**: The `sardo-follow-up-alerts` Supabase Edge Function sends notifications for relevant intervention follow-ups.
- **Privacy**: SARDO is restricted by role-based access and RLS policies; scores are intended to identify students who may need support, not to make automated decisions about them.

## 🛠️ Technology Stack

- **Frontend**: Clean HTML5, CSS3, and Vanilla JavaScript.
- **Backend**: Supabase (PostgreSQL Database + Edge Functions + Auth)
- **Real‑time**: Supabase Real‑time Database for live updates
- **Storage**: Supabase Storage for student photos and documents
- **Design**: Cultural-inspired theme using the traditional Blaan beadwork palette (Red, Yellow, Blue, Black, White).
- **Hosting**: GitHub Pages for frontend, Supabase for backend.
- **Security**: CryptoJS for PIN hashing, encrypted session storage, secure Messenger confirmation tokens, and Facebook webhook signature validation.

## 🚀 Deployment

The website is deployed on **GitHub Pages** with Supabase backend. SARDO requires the applicable SQL migrations in `supabase/migrations/`, including the risk-scoring function, process schema, calendar import, process improvements, pilot phase, and production risk-function migrations. Deploy the `sardo-follow-up-alerts` Edge Function from `supabase/functions/` and configure its `SARDO_ALERT_CRON_SECRET` when scheduled follow-up alerts are enabled.

## 🔒 Data Privacy & Security

This system complies with the **Data Privacy Act of 2012 (RA 10173)**. Key security measures include:
- Row Level Security (RLS) on all database tables
- Encrypted PIN storage (never stored in plaintext)
- Encrypted session storage
- Secure Messenger registration with unique confirmation tokens and verification codes
- Facebook webhook signature verification before processing Messenger events
- Rate limiting on login attempts
- HTTPS for all data transfers
- Role-Based Access Control (RBAC)

*Rooted in Heritage, Aiming for Excellence.*
