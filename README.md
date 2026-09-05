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

- **Secure Parent Registration**: Parents can link their children through a verified registration process.
- **Parent Access**: Securely view information for authorized linked students.
- **Student Selector**: Switch between multiple linked children.
- **Grades**: View available term grades and receive clear status updates when grades are temporarily unavailable.
- **Grade Visibility Controls**: Authorized school personnel can temporarily hide or restore grades for specific parent/student relationships.
- **Attendance History**: Review attendance records and daily summaries.
- **Achievements**: View student awards and recognitions.
- **Protected Student Photos**: Authorized parents can view photos of linked students through protected access.
- **Responsive Design**: Use the Parent Portal on desktop and mobile devices.

### Admin/Personnel Features

- **Attendance Management**: Record, review, and monitor student attendance.
- **Parent Notifications**: Send attendance updates to verified parent or guardian accounts.
- **Grade Management**: Encode, update, and manage student grades.
- **Parent Grade Access**: Temporarily hide or restore grades for selected parent/student relationships.
- **Achievements Management**: Record and maintain student awards and recognitions.
- **Student Records**: Manage authorized student information and related school records.
- **Student ID Generation**: Create student and personnel identification cards.
- **Reports and Exports**: Prepare supported school reports and administrative records.
- **Personnel Access Control**: Manage roles and permissions for authorized users.
- **Offline Support**: Continue selected workflows during temporary connectivity interruptions.

### Student Support and Attendance Risk Operations

- **Risk Monitoring**: Authorized personnel can review attendance patterns and identify learners who may need additional support.
- **Support Planning**: Staff can record follow-up actions, interventions, and progress notes.
- **Data Quality**: Attendance and school-calendar records can be reviewed and corrected before being used for assessment.
- **Review and Configuration**: Authorized staff can manage assessment settings and review previous assessments.
- **Privacy and Safeguards**: Access is restricted by role-based permissions and security policies. SARDO results support human review and are not used as automated decisions about students.

### Student Portal Features

- **Student Access**: Sign in with an approved school account.
- **Learning Hub**: Access student learning resources and portal activities.
- **Exam Activities**: View available exams and submit completed attempts.
- **Progress Review**: Review available scores and learning progress.
- **Protected Access**: Student content is restricted to authorized student accounts.

## 🛠️ Technology Stack

- **Frontend**: HTML5, CSS3, Tailwind CSS, and vanilla JavaScript.
- **Backend Services**: Managed cloud services for authentication, data storage, and portal operations.
- **Database**: Secure cloud database with role-based access controls and row-level security.
- **Storage**: Protected cloud storage for student photos, school documents, and portal resources.
- **Authentication**: Google authentication for personnel and students, plus secure PIN-based access for parents.
- **Notifications**: Facebook Messenger integration for parent attendance alerts.
- **Hosting**: GitHub Pages for the public website.
- **Design**: Responsive, mobile-friendly interfaces inspired by the traditional Blaan beadwork palette.
- **Privacy and Security**: Data protection controls aligned with the Data Privacy Act of 2012 (RA 10173).

## 🚀 Deployment

The public website is hosted on **GitHub Pages**. Student, parent, and personnel portal services use a managed backend with authenticated access, database security policies, and protected storage.

## 🔒 Data Privacy & Security

This system complies with the **Data Privacy Act of 2012 (RA 10173)**. Key security measures include:

- Row Level Security for protected student, parent, personnel, and portal data
- Encrypted PIN storage (never stored in plaintext)
- Short-lived signed sessions for protected portal requests
- Browser sessions treated as client-controlled
- Secure Messenger registration with unique confirmation tokens and verification codes
- Facebook webhook signature verification before processing Messenger events
- Server-side throttling for repeated parent login attempts
- Server-side attendance access policies for authorized personnel
- Per-parent grade visibility controls with optional automatic restoration
- Relationship-checked signed URLs for parent student photos
- HTTPS for all data transfers
- Role-Based Access Control (RBAC)

*Maintained for the Upper Labay High School community.*
