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
- **Secure Login**: PIN-based authentication with rate limiting and encrypted session storage.
- **Student Selector**: Switch between multiple linked children.
- **Grades Viewing**: Access term grades with color-coded performance indicators.
- **Attendance History**: View detailed attendance logs.
- **Achievements Tracking**: See student awards and recognitions.

### Admin/Personnel Features
- **Attendance Scanner**: Real‑time attendance tracking with QR code scanning.
- **Parent Messenger Alerts**: Automated Facebook Messenger notifications for student attendance.
- **SF2 & SF4 Exports**: Official DepEd School Forms 2 and 4 report generation.
- **Student ID Generator**: Digital student ID card creation with photo capture and QR codes.
- **Role‑Based Access**: Secure authentication with Google OAuth and Role‑Based Access Control (RBAC).
- **Hybrid Offline Support**: Works offline with local IndexedDB storage and syncs automatically when online.
- **Grades Encoding**: Full-featured grade management system with edit/delete capabilities.
- **Achievements Management**: Add and track student awards and achievements.
- **SARDO Risk Dashboard**: Student At-Risk Dropout monitoring system.
- **Access Control**: Manage personnel permissions and roles.

## 🛠️ Technology Stack

- **Frontend**: Clean HTML5, CSS3, and Vanilla JavaScript.
- **Backend**: Supabase (PostgreSQL Database + Edge Functions + Auth)
- **Real‑time**: Supabase Real‑time Database for live updates
- **Storage**: Supabase Storage for student photos and documents
- **Design**: Cultural-inspired theme using the traditional Blaan beadwork palette (Red, Yellow, Blue, Black, White).
- **Hosting**: GitHub Pages for frontend, Supabase for backend.
- **Security**: CryptoJS for PIN hashing and encrypted session storage.

## 🚀 Deployment

The website is deployed on **GitHub Pages** with Supabase backend.

## 🔒 Data Privacy & Security

This system complies with the **Data Privacy Act of 2012 (RA 10173)**. Key security measures include:
- Row Level Security (RLS) on all database tables
- Encrypted PIN storage (never stored in plaintext)
- Encrypted session storage
- Rate limiting on login attempts
- HTTPS for all data transfers
- Role-Based Access Control (RBAC)

*Rooted in Heritage, Aiming for Excellence.*
