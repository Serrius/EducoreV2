# 🎓 Educore Academic Management System

Educore is a centralized Academic Organization Management System designed to streamline accreditation, event monitoring, financial tracking, announcements, and digital governance within educational institutions.

Built to enhance transparency, accountability, and operational efficiency across student organizations and administrative offices.

---

# 🚀 System Overview

Educore provides a structured workflow between:

- 👨‍🎓 Students
- 🧑‍💼 Organization Officers
- 🛡 Special Admin
- 👑 Super Admin
- 🏫 Faculty Admin
- 👀 Overseer

The system ensures academic term control, accreditation validation, financial transparency, and structured communication.

---

# ✨ Core Features

## 🏫 Academic Term Management
- School Year + Semester structure
- Active / Closed term control
- Enforced uniqueness per school year + semester
- Controls system-wide filtering behavior

---

## 📑 Accreditation System
- One accreditation per organization per academic term
- Draft → Pending → Returned → Recommended → Approved → Active workflow
- Digital requirement submission
- Document validation
- Renewal support
- Template versioning
- Coordinator and Moderator assignment

---

## 📢 Announcement System
- Targeted announcements
- Organization-level targeting
- Individual user targeting
- Academic term based filtering
- Pending → Active → Archived lifecycle

---

## 📊 Event Management
- Proposal submission workflow
- Draft → Submitted → Approved → Declined states
- Organization or General scope
- Academic year tracking
- Accomplishment submission & approval

---

## 💰 Financial Tracking System (Passbook System)

### Credits & Debits
- Event-based financial tracking
- Automatic passbook log generation
- Running balance calculation
- Linked to organization
- Recorded by user tracking

### Ensures:
- Transparency
- Immutable financial logs
- Proper audit trail

---

## 🔔 Notification System
Supports notification types:
- Registration
- Academic Year
- General
- Announcement
- Accreditation
- Payment
- Reaccreditation
- Club

Features:
- Read / Unread tracking
- Actor tracking
- Role-based visibility

---

## ✍️ E-Signature System
- One active e-signature per user
- Officer validation support
- Used in financial and accreditation processes

---

## 👥 Organization Management

- Organization / Club type distinction
- General / Exclusive scope
- Membership fee handling
- Officer position tracking
- Membership receipts
- Fee receipts
- Status control (Active / Inactive / Archived)

---

# 🛠 Tech Stack

## Frontend
- HTML5
- Bootstrap 5
- Vanilla JavaScript (modular architecture)
- Poppins Font
- Responsive Design

## Backend
- PHP (PDO)
- MariaDB / MySQL
- REST-style JSON endpoints
- Session-based authentication

## Database
MariaDB 10.4+
Strict relational structure
Foreign key enforced integrity

---

# 🗄 Database Highlights

### Important Constraints

- Unique `(school_year, semester)` on academic_terms
- Unique `(org_id, academic_term_id)` on accreditation_requests
- Unique `(org_id, student_user_id, academic_term_id)` on memberships
- Unique receipt numbers
- Role-based user constraints
- Indexed active role history

---

# 🔐 Roles & Permissions

| Role | Capabilities |
|------|-------------|
| student | View announcements, join orgs, pay fees |
| org_officer | Manage events, expenses, submissions |
| treasurer | Manage financial records |
| org_president | Accreditation oversight |
| moderator | Accreditation validation |
| faculty_admin | Administrative monitoring |
| special_admin | System-level approval workflows |
| super_admin | Full control + activation authority |
| overseer | View-only auditing |

---

# 📂 Project Structure
