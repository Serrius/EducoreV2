-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Host: 127.0.0.1
-- Generation Time: Mar 21, 2026 at 07:21 AM
-- Server version: 10.4.28-MariaDB
-- PHP Version: 8.0.30

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `educorev2`
--

-- --------------------------------------------------------

--
-- Table structure for table `academic_terms`
--

CREATE TABLE `academic_terms` (
  `id` int(10) UNSIGNED NOT NULL,
  `school_year` varchar(9) NOT NULL,
  `semester` enum('1st','2nd','Summer') NOT NULL,
  `status` enum('Active','Closed') NOT NULL DEFAULT 'Closed',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `academic_terms`
--

INSERT INTO `academic_terms` (`id`, `school_year`, `semester`, `status`, `created_at`) VALUES
(1, '2025-2026', '1st', 'Closed', '2026-01-19 03:14:13'),
(2, '2026-2027', '1st', 'Closed', '2026-01-19 03:15:31'),
(4, '2026-2027', '2nd', 'Active', '2026-02-21 09:24:38');

-- --------------------------------------------------------

--
-- Table structure for table `accreditation_requests`
--

CREATE TABLE `accreditation_requests` (
  `id` int(10) UNSIGNED NOT NULL,
  `org_id` int(10) UNSIGNED NOT NULL,
  `academic_term_id` int(10) UNSIGNED NOT NULL,
  `coordinator_user_id` int(10) UNSIGNED NOT NULL,
  `moderator_user_id` int(10) UNSIGNED DEFAULT NULL,
  `status` enum('Draft','Pending','Returned','Recommended','Approved','Rejected','Active') NOT NULL DEFAULT 'Pending',
  `submitted_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `special_admin_notes` text DEFAULT NULL,
  `super_admin_notes` text DEFAULT NULL,
  `is_renewal` tinyint(1) DEFAULT 0,
  `previous_request_id` int(10) UNSIGNED DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `accreditation_requests`
--

INSERT INTO `accreditation_requests` (`id`, `org_id`, `academic_term_id`, `coordinator_user_id`, `moderator_user_id`, `status`, `submitted_at`, `updated_at`, `special_admin_notes`, `super_admin_notes`, `is_renewal`, `previous_request_id`) VALUES
(1, 1, 1, 24, 24, 'Pending', '2026-02-06 05:38:35', '2026-03-15 09:15:01', 'RECOMMENDATION_FILE=assets/uploads/accreditation/recommendations/1/Interfaces-Revise_20260207_072412_63566161.pdf', NULL, 0, NULL),
(6, 1, 2, 24, 24, 'Active', '2026-02-07 07:20:41', '2026-03-15 09:15:01', 'RECOMMENDATION_FILE=assets/uploads/accreditation/recommendations/6/recommendation_6_20260315_091217_2643903d.pdf', 'Activated by Super Admin (user_id=4) on 2026-02-09 15:16:12\nActivated by Super Admin (user_id=4) on 2026-02-09 15:31:37\nActivated by Super Admin (user_id=4) on 2026-02-09 18:33:34\nActivated by Super Admin (user_id=4) on 2026-02-09 22:50:21\nActivated by Super Admin (user_id=4) on 2026-02-11 04:38:29\n[2026-03-04 03:37:02 user_id=4] goodjob steve jobs\nActivated by Super Admin (user_id=4) on 2026-03-04 03:48:36\n[2026-03-04 04:04:40 user_id=4] goodjob\nActivated by Super Admin (user_id=4) on 2026-03-08 12:05:33\nActivated by Super Admin (user_id=4) on 2026-03-08 12:29:10\nActivated by Super Admin (user_id=4) on 2026-03-08 13:01:08\nActivated by Super Admin (user_id=4) on 2026-03-08 13:05:38\nActivated by Super Admin (user_id=4) on 2026-03-08 13:10:35\n[2026-03-15 09:13:52 user_id=4] ACTIVATE', 1, 1),
(7, 2, 2, 24, 7, 'Active', '2026-02-10 01:52:46', '2026-03-18 02:01:39', 'RECOMMENDATION_FILE=assets/uploads/accreditation/recommendations/7/recommendation_7_20260315_094938_63003290.pdf', 'Activated by Super Admin (user_id=4) on 2026-02-10 03:02:09\n[2026-03-15 09:50:01 user_id=4] ACTIVATE', 0, NULL),
(8, 3, 2, 36, 36, 'Active', '2026-02-14 11:38:49', '2026-03-15 09:15:00', 'RECOMMENDATION_FILE=assets/uploads/accreditation/recommendations/8/recommendation_8_20260303_072555_65077c80.pdf\nasdasdas', '[2026-02-26 02:23:01 user_id=4] approve na kasamok\nActivated by Super Admin (user_id=4) on 2026-03-08 12:13:38', 0, NULL),
(9, 4, 4, 37, 37, 'Pending', '2026-03-06 07:04:56', '2026-03-15 09:15:00', NULL, NULL, 0, NULL),
(12, 7, 4, 41, NULL, 'Pending', '2026-03-09 07:25:52', '2026-03-09 07:25:52', NULL, NULL, 0, NULL),
(13, 8, 4, 24, 7, 'Active', '2026-03-15 07:31:09', '2026-03-18 03:35:07', 'RECOMMENDATION_FILE=assets/uploads/accreditation/recommendations/13/recommendation_13_20260318_043442_ab087957.pdf', '[2026-03-15 09:09:58 user_id=4] ACTIVATE\nActivated by Super Admin (user_id=4) on 2026-03-18 04:35:07', 0, NULL);

-- --------------------------------------------------------

--
-- Table structure for table `accreditation_request_documents`
--

CREATE TABLE `accreditation_request_documents` (
  `id` int(10) UNSIGNED NOT NULL,
  `request_id` int(10) UNSIGNED NOT NULL,
  `requirement_id` int(10) UNSIGNED NOT NULL,
  `file_path` varchar(255) NOT NULL,
  `file_name` varchar(255) DEFAULT NULL,
  `status` enum('Submitted','Accepted','Returned','Pending') NOT NULL DEFAULT 'Submitted',
  `reviewed_by` int(10) UNSIGNED DEFAULT NULL,
  `reviewed_at` timestamp NULL DEFAULT NULL,
  `return_reason` text DEFAULT NULL,
  `uploaded_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `copied_from_doc_id` int(10) UNSIGNED DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `accreditation_request_documents`
--

INSERT INTO `accreditation_request_documents` (`id`, `request_id`, `requirement_id`, `file_path`, `file_name`, `status`, `reviewed_by`, `reviewed_at`, `return_reason`, `uploaded_at`, `copied_from_doc_id`) VALUES
(1, 1, 1, 'assets/uploads/accreditation/1/req_1/replace_req1_20260207_050326_f0130c3a_GENERAL-COMMENTS.pdf', 'GENERAL-COMMENTS.pdf', 'Accepted', 3, '2026-02-07 04:37:59', NULL, '2026-02-07 04:03:26', NULL),
(6, 6, 1, 'assets/uploads/accreditation/6/req_1/req1_20260304_040308_34d0c97c_MaEase_Final.pdf', 'MaEase_Final.pdf', 'Accepted', 3, '2026-03-04 03:03:46', NULL, '2026-03-04 03:03:08', 1),
(7, 6, 2, 'assets/uploads/accreditation/6/req_2/req2_20260308_130448_0f65f163_accomplishment-report _1_.pdf', 'accomplishment-report (1).pdf', 'Accepted', 39, '2026-03-13 02:02:16', NULL, '2026-03-08 12:04:48', NULL),
(8, 7, 1, 'assets/uploads/accreditation/7/req_1/req1_20260210_025246_976b7f7f_Interfaces-Revise.pdf', 'Interfaces-Revise.pdf', 'Accepted', 39, '2026-03-15 08:49:34', NULL, '2026-02-10 01:52:46', NULL),
(9, 7, 2, 'assets/uploads/accreditation/7/req_2/req2_20260315_080252_7eeb87a1_Untitled _16_.pdf', 'Untitled (16).pdf', 'Accepted', 39, '2026-03-15 08:49:34', NULL, '2026-03-15 07:02:52', NULL),
(10, 8, 1, 'assets/uploads/accreditation/8/req_1/req1_20260214_123849_5aebd8f6_Interfaces-Revise.pdf', 'Interfaces-Revise.pdf', 'Accepted', 3, '2026-02-25 08:07:09', NULL, '2026-02-14 11:38:49', NULL),
(11, 8, 2, 'assets/uploads/accreditation/8/req_2/req2_20260214_123849_b107989b_GENERAL-COMMENTS.pdf', 'GENERAL-COMMENTS.pdf', 'Accepted', 3, '2026-02-25 08:07:09', NULL, '2026-02-14 11:38:49', NULL),
(12, 6, 3, 'assets/uploads/accreditation/6/req_3/req3_20260308_130448_3c72b731_accomplishment-report _1_.pdf', 'accomplishment-report (1).pdf', 'Accepted', 39, '2026-03-15 08:12:06', NULL, '2026-03-08 12:04:48', NULL),
(13, 9, 5, 'assets/uploads/accreditation/9/req_5/req5_20260306_080920_d8006257_accomplishment-report _1_.pdf', 'accomplishment-report (1).pdf', 'Submitted', NULL, NULL, NULL, '2026-03-06 07:09:20', NULL),
(14, 9, 2, 'assets/uploads/accreditation/9/req_2/req2_20260306_080920_f4b4c3fb_accomplishment-report _1_.pdf', 'accomplishment-report (1).pdf', 'Submitted', NULL, NULL, NULL, '2026-03-06 07:09:20', NULL),
(15, 9, 3, 'assets/uploads/accreditation/9/req_3/req3_20260306_080920_096e2adb_accomplishment-report _1_.pdf', 'accomplishment-report (1).pdf', 'Submitted', NULL, NULL, NULL, '2026-03-06 07:09:20', NULL),
(16, 6, 5, 'assets/uploads/accreditation/6/req_5/req5_20260308_130448_2c5e605e_accomplishment-report _1_.pdf', 'accomplishment-report (1).pdf', 'Accepted', 39, '2026-03-13 02:02:12', NULL, '2026-03-08 12:04:48', NULL),
(20, 12, 5, 'assets/uploads/accreditation/12/req_5/req5_20260309_082552_dd2a4867_March 3.pdf', 'March 3.pdf', 'Accepted', 39, '2026-03-13 01:26:06', NULL, '2026-03-09 07:25:52', NULL),
(21, 12, 2, 'assets/uploads/accreditation/12/req_2/req2_20260309_082552_7a3673ad_March 3.pdf', 'March 3.pdf', 'Accepted', 39, '2026-03-13 01:26:10', NULL, '2026-03-09 07:25:52', NULL),
(22, 12, 3, 'assets/uploads/accreditation/12/req_3/req3_20260309_082552_76cebd4a_March 3.pdf', 'March 3.pdf', 'Accepted', 39, '2026-03-13 01:26:15', NULL, '2026-03-09 07:25:52', NULL),
(23, 7, 5, 'assets/uploads/accreditation/7/req_5/req5_20260315_080252_57a37b47_Untitled _16_.pdf', 'Untitled (16).pdf', 'Accepted', 39, '2026-03-15 08:49:34', NULL, '2026-03-15 07:02:52', NULL),
(24, 7, 3, 'assets/uploads/accreditation/7/req_3/req3_20260315_080252_8d79d63b_ISO.pdf', 'ISO.pdf', 'Accepted', 39, '2026-03-15 08:49:34', NULL, '2026-03-15 07:02:52', NULL),
(25, 13, 5, 'assets/uploads/accreditation/13/req_5/req5_20260315_083109_0423dd43_ISO.pdf', 'ISO.pdf', 'Accepted', 39, '2026-03-15 08:09:30', NULL, '2026-03-15 07:31:09', NULL),
(26, 13, 2, 'assets/uploads/accreditation/13/req_2/req2_20260315_083109_85006af3_ISO.pdf', 'ISO.pdf', 'Accepted', 39, '2026-03-15 08:09:33', NULL, '2026-03-15 07:31:09', NULL),
(27, 13, 3, 'assets/uploads/accreditation/13/req_3/req3_20260315_083109_d232d99c_ISO.pdf', 'ISO.pdf', 'Accepted', 39, '2026-03-15 08:09:35', NULL, '2026-03-15 07:31:09', NULL);

-- --------------------------------------------------------

--
-- Table structure for table `accreditation_requirements`
--

CREATE TABLE `accreditation_requirements` (
  `id` int(10) UNSIGNED NOT NULL,
  `requirement_name` varchar(255) NOT NULL,
  `applies_to` enum('General','Exclusive','Club','All') NOT NULL DEFAULT 'All',
  `sort_order` int(11) NOT NULL DEFAULT 0,
  `status` enum('Active','Archived') NOT NULL DEFAULT 'Active',
  `created_by` int(10) UNSIGNED DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `accreditation_requirements`
--

INSERT INTO `accreditation_requirements` (`id`, `requirement_name`, `applies_to`, `sort_order`, `status`, `created_by`, `created_at`) VALUES
(1, 'rename', 'All', 1, 'Archived', 3, '2026-02-03 18:13:29'),
(2, 'sample 2', 'All', 2, 'Active', 3, '2026-02-07 04:38:28'),
(3, 'sample 3', 'All', 3, 'Active', 3, '2026-03-03 01:24:29'),
(4, 'requirements', 'All', 4, 'Archived', 3, '2026-03-03 02:52:33'),
(5, 'sample 1', 'All', 0, 'Active', 3, '2026-03-04 04:35:22');

-- --------------------------------------------------------

--
-- Table structure for table `accreditation_requirement_templates`
--

CREATE TABLE `accreditation_requirement_templates` (
  `id` int(10) UNSIGNED NOT NULL,
  `requirement_id` int(10) UNSIGNED NOT NULL,
  `file_path` varchar(255) NOT NULL,
  `file_name` varchar(255) DEFAULT NULL,
  `file_type` enum('PDF','DOCX') NOT NULL DEFAULT 'PDF',
  `version` int(11) NOT NULL DEFAULT 1,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `uploaded_by` int(10) UNSIGNED DEFAULT NULL,
  `uploaded_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `accreditation_requirement_templates`
--

INSERT INTO `accreditation_requirement_templates` (`id`, `requirement_id`, `file_path`, `file_name`, `file_type`, `version`, `is_active`, `uploaded_by`, `uploaded_at`) VALUES
(2, 1, 'assets/uploads/accreditation/templates/1/Interfaces-Revise_20260203_195759_9a617da5.pdf', 'Interfaces-Revise.pdf', 'PDF', 1, 1, 3, '2026-02-03 18:57:59'),
(3, 2, 'assets/uploads/accreditation/templates/2/GENERAL-COMMENTS_20260207_053840_f8e11881.pdf', 'GENERAL-COMMENTS.pdf', 'PDF', 1, 1, 3, '2026-02-07 04:38:40'),
(4, 3, 'assets/uploads/accreditation/templates/3/ACCEPTANCE-LETTER-USTP_20260303_022451_792fa869.pdf', 'ACCEPTANCE-LETTER-USTP.pdf', 'PDF', 1, 1, 3, '2026-03-03 01:24:51'),
(5, 4, 'assets/uploads/accreditation/templates/4/MaEase_Final_20260303_035244_482dc485.pdf', 'MaEase_Final.pdf', 'PDF', 1, 1, 3, '2026-03-03 02:52:44');

-- --------------------------------------------------------

--
-- Table structure for table `admin_role_history`
--

CREATE TABLE `admin_role_history` (
  `id` int(10) UNSIGNED NOT NULL,
  `user_id` int(10) UNSIGNED NOT NULL,
  `role` enum('super_admin','special_admin') NOT NULL,
  `id_number` varchar(50) NOT NULL,
  `first_name` varchar(100) NOT NULL,
  `middle_name` varchar(100) DEFAULT NULL,
  `last_name` varchar(100) NOT NULL,
  `suffix` varchar(20) DEFAULT NULL,
  `email` varchar(255) DEFAULT NULL,
  `assigned_at` datetime NOT NULL DEFAULT current_timestamp(),
  `revoked_at` datetime DEFAULT NULL,
  `reason` varchar(255) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `admin_role_history`
--

INSERT INTO `admin_role_history` (`id`, `user_id`, `role`, `id_number`, `first_name`, `middle_name`, `last_name`, `suffix`, `email`, `assigned_at`, `revoked_at`, `reason`) VALUES
(1, 4, 'super_admin', '11111', 'Super', NULL, 'Admin', NULL, NULL, '2026-01-17 13:59:23', '2026-01-17 15:30:41', 'Nag resign ang boang'),
(2, 4, 'super_admin', '11111', 'Super', NULL, 'Admin', NULL, NULL, '2026-01-17 15:30:41', '2026-01-17 15:30:41', 'replaced for being so buns'),
(3, 3, 'special_admin', '2025303899', 'Special', NULL, 'Admin', NULL, 'special.admin@example.com', '2026-01-18 08:06:45', '2026-01-18 08:06:45', NULL),
(4, 6, 'special_admin', '1231233', 'this', 'is', 'just a test', NULL, NULL, '2026-01-18 10:09:27', '2026-01-18 10:09:27', 'Restored from Restore Admins tab'),
(5, 5, 'super_admin', '2222', 'Tester', NULL, 'Tester', NULL, NULL, '2026-01-18 10:09:43', '2026-01-18 10:09:43', 'Restored from Restore Admins tab'),
(6, 4, 'super_admin', '11111', 'Super', NULL, 'Admin', NULL, NULL, '2026-01-18 10:54:40', '2026-01-18 10:54:40', 'Restored from Restore Admins tab'),
(7, 5, 'super_admin', '2222', 'Tester', NULL, 'Tester', NULL, NULL, '2026-01-18 10:55:28', '2026-01-18 10:55:28', 'Restored from Restore Admins tab'),
(8, 4, 'super_admin', '11111', 'Super', NULL, 'Admin', NULL, NULL, '2026-01-18 11:38:17', '2026-01-18 11:38:17', 'Revoked due to restoring Tester Tester'),
(9, 5, 'super_admin', '2222', 'Tester', NULL, 'Tester', NULL, NULL, '2026-01-18 11:38:30', '2026-01-18 11:38:30', 'Revoked due to restoring Super Admin'),
(10, 3, 'special_admin', '2025303899', 'Special', NULL, 'Admin', NULL, 'special.admin@example.com', '2026-03-04 16:37:41', '2026-03-04 16:37:41', 'new term');

-- --------------------------------------------------------

--
-- Table structure for table `announcements`
--

CREATE TABLE `announcements` (
  `id` int(10) UNSIGNED NOT NULL,
  `org_id` int(10) UNSIGNED DEFAULT NULL,
  `academic_term_id` int(10) UNSIGNED NOT NULL,
  `target_user_id` int(10) UNSIGNED DEFAULT NULL,
  `target_program` varchar(50) DEFAULT NULL,
  `title` varchar(255) NOT NULL,
  `body` text NOT NULL,
  `status` enum('Pending','Active','Declined','Archived') NOT NULL DEFAULT 'Pending',
  `created_by` int(10) UNSIGNED NOT NULL,
  `reviewed_by` int(10) UNSIGNED DEFAULT NULL,
  `reviewed_at` datetime DEFAULT NULL,
  `review_note` varchar(255) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `announcements`
--

INSERT INTO `announcements` (`id`, `org_id`, `academic_term_id`, `target_user_id`, `target_program`, `title`, `body`, `status`, `created_by`, `reviewed_by`, `reviewed_at`, `review_note`, `created_at`, `updated_at`) VALUES
(1, 1, 2, 7, NULL, 'Testing Testing this should be so interesting', 'Test', 'Archived', 24, 24, '2026-02-21 16:40:33', NULL, '2026-02-21 06:14:25', '2026-02-21 08:40:33'),
(2, NULL, 4, 4, NULL, 'test', 'test', 'Active', 4, NULL, NULL, NULL, '2026-02-26 02:03:14', NULL),
(3, 1, 4, NULL, NULL, 'balls', 'aksjdlaksjdlaksjdlaksd', 'Archived', 24, 24, '2026-02-26 10:46:31', NULL, '2026-02-26 02:28:54', '2026-02-26 02:46:31'),
(4, 1, 4, NULL, NULL, 'ww2', 'test', 'Archived', 31, 24, '2026-03-08 18:50:05', NULL, '2026-03-06 06:37:58', '2026-03-08 10:50:05'),
(5, 1, 4, NULL, NULL, '22', 'www', 'Archived', 31, 24, '2026-03-07 18:58:45', NULL, '2026-03-06 06:46:31', '2026-03-07 10:58:45'),
(6, 1, 4, NULL, NULL, 'asdas', 'asdasda', 'Active', 31, 24, '2026-03-13 10:21:48', NULL, '2026-03-08 13:45:58', '2026-03-13 02:21:48'),
(7, 1, 4, NULL, NULL, 'test', 'test', 'Active', 24, 24, '2026-03-13 10:21:51', NULL, '2026-03-13 02:21:46', '2026-03-13 02:21:51'),
(8, 1, 4, NULL, NULL, 'testing again', 'teste', 'Active', 31, 4, '2026-03-15 06:59:05', NULL, '2026-03-13 02:50:54', '2026-03-14 22:59:05'),
(9, NULL, 4, 7, NULL, 'this is a targeted announcement', 'targeted announcement to Karl: Notice this is a targeted announcement the person being targeted in question is Karl', 'Active', 4, NULL, NULL, NULL, '2026-03-15 04:46:32', NULL);

-- --------------------------------------------------------

--
-- Table structure for table `event_accomplishments`
--

CREATE TABLE `event_accomplishments` (
  `id` int(10) UNSIGNED NOT NULL,
  `event_id` int(10) UNSIGNED NOT NULL,
  `objectives` text NOT NULL,
  `outcomes` text NOT NULL,
  `challenges` text DEFAULT NULL,
  `status` enum('Draft','Submitted','Approved','Declined') NOT NULL DEFAULT 'Draft',
  `submitted_by` int(10) UNSIGNED DEFAULT NULL,
  `submitted_at` datetime DEFAULT NULL,
  `approved_by` int(10) UNSIGNED DEFAULT NULL,
  `approved_at` datetime DEFAULT NULL,
  `declined_reason` text DEFAULT NULL,
  `finalized_by` int(10) UNSIGNED DEFAULT NULL,
  `finalized_at` datetime DEFAULT NULL,
  `generated_pdf` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `event_credits`
--

CREATE TABLE `event_credits` (
  `id` int(10) UNSIGNED NOT NULL,
  `event_id` int(10) UNSIGNED NOT NULL,
  `credit_date` date NOT NULL,
  `source` varchar(160) NOT NULL,
  `notes` varchar(255) DEFAULT NULL,
  `amount` decimal(10,2) NOT NULL,
  `recorded_by_user_id` int(10) UNSIGNED NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `event_debits`
--

CREATE TABLE `event_debits` (
  `id` int(10) UNSIGNED NOT NULL,
  `event_id` int(10) UNSIGNED NOT NULL,
  `debit_date` date NOT NULL,
  `category` varchar(80) NOT NULL,
  `notes` varchar(255) DEFAULT NULL,
  `amount` decimal(10,2) NOT NULL,
  `unit_price` decimal(10,2) DEFAULT NULL,
  `quantity` int(11) NOT NULL DEFAULT 1,
  `receipt_path` varchar(255) DEFAULT NULL,
  `receipt_number` varchar(100) DEFAULT NULL,
  `recorded_by_user_id` int(10) UNSIGNED NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `event_events`
--

CREATE TABLE `event_events` (
  `id` int(10) UNSIGNED NOT NULL,
  `org_id` int(10) UNSIGNED DEFAULT NULL,
  `title` varchar(200) NOT NULL,
  `event_date` date NOT NULL,
  `location` varchar(255) NOT NULL,
  `scope` enum('general','organization') NOT NULL DEFAULT 'general',
  `description` text DEFAULT NULL,
  `proposed_grand_total` decimal(10,2) DEFAULT 0.00,
  `proposed_breakdown_notes` text DEFAULT NULL,
  `active_year` int(11) NOT NULL,
  `start_year` int(11) NOT NULL,
  `end_year` int(11) NOT NULL,
  `status` enum('Draft','Submitted','Approved','Declined') NOT NULL DEFAULT 'Draft',
  `author_user_id` int(10) UNSIGNED NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp(),
  `proposal_approved_at` datetime DEFAULT NULL,
  `proposal_approved_by` int(11) DEFAULT NULL,
  `accomplishment_status` enum('Locked','Draft','Submitted','Approved','Declined') NOT NULL DEFAULT 'Locked',
  `accomplishment_file` varchar(255) DEFAULT NULL,
  `accomplishment_notes` text DEFAULT NULL,
  `accomplishment_submitted_at` datetime DEFAULT NULL,
  `accomplishment_approved_at` datetime DEFAULT NULL,
  `accomplishment_approved_by` int(11) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `event_events`
--

INSERT INTO `event_events` (`id`, `org_id`, `title`, `event_date`, `location`, `scope`, `description`, `proposed_grand_total`, `proposed_breakdown_notes`, `active_year`, `start_year`, `end_year`, `status`, `author_user_id`, `created_at`, `updated_at`, `proposal_approved_at`, `proposal_approved_by`, `accomplishment_status`, `accomplishment_file`, `accomplishment_notes`, `accomplishment_submitted_at`, `accomplishment_approved_at`, `accomplishment_approved_by`) VALUES
(39, 1, 'chachoy', '2026-03-21', 'USTP JASAAN', 'organization', 'asdasd', 0.00, NULL, 2, 2026, 2027, 'Submitted', 31, '2026-03-21 13:32:22', '2026-03-21 13:32:22', NULL, NULL, 'Locked', NULL, NULL, NULL, NULL, NULL),
(40, 1, 'asda', '2026-03-21', 'asdasd', 'organization', 'asdasdasd', 0.00, NULL, 2, 2026, 2027, 'Submitted', 31, '2026-03-21 14:10:44', '2026-03-21 14:10:44', NULL, NULL, 'Locked', NULL, NULL, NULL, NULL, NULL),
(41, 1, 'asdasd', '2026-03-21', 'asdasd', 'organization', 'asdasdas', 0.00, NULL, 2, 2026, 2027, 'Submitted', 31, '2026-03-21 14:16:19', '2026-03-21 14:16:19', NULL, NULL, 'Locked', NULL, NULL, NULL, NULL, NULL);

-- --------------------------------------------------------

--
-- Table structure for table `event_proposed_credits`
--

CREATE TABLE `event_proposed_credits` (
  `id` int(10) UNSIGNED NOT NULL,
  `event_id` int(10) UNSIGNED NOT NULL,
  `description` varchar(255) NOT NULL,
  `amount` decimal(10,2) NOT NULL,
  `notes` text DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `event_proposed_credits`
--

INSERT INTO `event_proposed_credits` (`id`, `event_id`, `description`, `amount`, `notes`, `created_at`) VALUES
(1, 39, 'ballsack', 5000.00, 'asdasd', '2026-03-21 13:32:22'),
(2, 41, 'asd', 5000.00, 'asda', '2026-03-21 14:16:19');

-- --------------------------------------------------------

--
-- Table structure for table `event_proposed_expenses`
--

CREATE TABLE `event_proposed_expenses` (
  `id` int(10) UNSIGNED NOT NULL,
  `event_id` int(10) UNSIGNED NOT NULL,
  `description` varchar(255) NOT NULL,
  `quantity` int(11) NOT NULL DEFAULT 1,
  `estimated_cost` decimal(10,2) NOT NULL DEFAULT 0.00,
  `total` decimal(10,2) GENERATED ALWAYS AS (`quantity` * `estimated_cost`) STORED,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp(),
  `notes` text DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `event_proposed_expenses`
--

INSERT INTO `event_proposed_expenses` (`id`, `event_id`, `description`, `quantity`, `estimated_cost`, `created_at`, `updated_at`, `notes`) VALUES
(2, 39, 'asdasd', 2, 500.00, '2026-03-21 13:32:22', NULL, 'asdasd'),
(3, 40, 'asdasd', 2, 500.00, '2026-03-21 14:10:44', NULL, NULL),
(4, 41, 'asdasdasd', 1, 5000.00, '2026-03-21 14:16:19', NULL, 'asdasdasd');

-- --------------------------------------------------------

--
-- Table structure for table `e_signatures`
--

CREATE TABLE `e_signatures` (
  `id` int(10) UNSIGNED NOT NULL,
  `user_id` int(10) UNSIGNED NOT NULL,
  `signature_file` varchar(255) DEFAULT NULL,
  `status` enum('Active','Removed') NOT NULL DEFAULT 'Active',
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `e_signatures`
--

INSERT INTO `e_signatures` (`id`, `user_id`, `signature_file`, `status`, `updated_at`) VALUES
(1, 4, 'assets/uploads/e-signatures/4/signature_20260128_113836_6f3cf4e2.png', 'Active', '2026-01-28 10:38:36'),
(4, 3, 'assets/uploads/e-signatures/3/signature_20260128_113659_489de971.png', 'Active', '2026-01-28 10:36:59'),
(6, 29, 'assets/uploads/e-signatures/29/signature_20260210_094937_7a2a6833.png', 'Active', '2026-02-10 08:49:37'),
(7, 31, 'assets/uploads/e-signatures/31/signature_20260211_071332_108b07cd.png', 'Active', '2026-02-11 06:13:32'),
(8, 35, 'assets/uploads/e-signatures/35/signature_20260214_080323_62556260.png', 'Active', '2026-02-14 07:03:23'),
(9, 39, 'assets/uploads/e-signatures/39/signature_20260308_120445_cf4033dc.png', 'Active', '2026-03-08 11:04:45'),
(10, 24, 'assets/uploads/e-signatures/24/signature_20260312_062713_c78aeeb5.png', 'Active', '2026-03-12 05:27:13');

-- --------------------------------------------------------

--
-- Table structure for table `notifications`
--

CREATE TABLE `notifications` (
  `id` int(11) NOT NULL,
  `recipient_id` int(10) UNSIGNED NOT NULL,
  `actor_id` int(10) UNSIGNED DEFAULT NULL,
  `title` varchar(255) NOT NULL,
  `message` text DEFAULT NULL,
  `notif_type` enum('registration','academic-year','general','announcement','accreditation','payment','reaccreditation','club','accomplishment') NOT NULL DEFAULT 'general',
  `status` enum('unread','read') DEFAULT 'unread',
  `payload_id` int(11) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `notifications`
--

INSERT INTO `notifications` (`id`, `recipient_id`, `actor_id`, `title`, `message`, `notif_type`, `status`, `payload_id`, `created_at`) VALUES
(1, 24, 3, 'Document Returned - Needs Revision', 'Your document for requirement \'example\' in organization \'Society of Computer Enthusiast\' has been returned by the Special Admin. Reason: bro this shit is trash', 'accreditation', 'unread', 1, '2026-02-07 00:59:31'),
(2, 3, 24, 'Document Replaced - Requires Review', 'A document has been replaced for accreditation request #1 by tester tester. The request status has been reset to Pending.', 'accreditation', 'unread', 1, '2026-02-07 01:02:33'),
(3, 24, 24, 'Document Replaced', 'You have successfully replaced the document for requirement #1. The request status has been reset to Pending.', 'accreditation', 'unread', 1, '2026-02-07 01:02:33'),
(4, 24, 3, 'Accreditation Recommended', 'Your accreditation request for organization \'Society of Computer Enthusiast\' has been recommended by the Special Admin and is now pending Super Admin approval.', 'accreditation', 'unread', 1, '2026-02-07 03:25:05'),
(5, 24, 3, 'Document Returned - Needs Revision', 'Your document for requirement \'example\' in organization \'Society of Computer Enthusiast\' has been returned by the Special Admin. Reason: asdasdasd', 'accreditation', 'unread', 1, '2026-02-07 03:44:59'),
(6, 24, 3, 'Document Returned - Needs Revision', 'Your document for requirement \'example\' in organization \'Society of Computer Enthusiast\' has been returned by the Special Admin. Reason: asdasd', 'accreditation', 'unread', 1, '2026-02-07 03:53:34'),
(7, 3, 24, 'Document Replaced - Requires Review', 'A document has been replaced for accreditation request #1 by tester tester. The request status has been reset to Pending.', 'accreditation', 'unread', 1, '2026-02-07 04:03:26'),
(8, 24, 24, 'Document Replaced', 'You have successfully replaced the document for requirement #1. The request status has been reset to Pending.', 'accreditation', 'unread', 1, '2026-02-07 04:03:26'),
(9, 24, 3, 'Document Accepted', 'Your document for requirement \'example\' in organization \'Society of Computer Enthusiast\' has been accepted by the Special Admin.', 'accreditation', 'unread', 1, '2026-02-07 04:17:43'),
(10, 24, 3, 'Document Returned - Needs Revision', 'Your document for requirement \'example\' in organization \'Society of Computer Enthusiast\' has been returned by the Special Admin. Reason: bro this is so ass', 'accreditation', 'unread', 1, '2026-02-07 04:37:40'),
(11, 24, 3, 'Document Accepted', 'Your document for requirement \'example\' in organization \'Society of Computer Enthusiast\' has been accepted by the Special Admin.', 'accreditation', 'unread', 1, '2026-02-07 04:37:44'),
(12, 24, 3, 'Document Returned - Needs Revision', 'Your document for requirement \'example\' in organization \'Society of Computer Enthusiast\' has been returned by the Special Admin. Reason: bro this is so ass', 'accreditation', 'unread', 1, '2026-02-07 04:37:52'),
(13, 24, 3, 'Document Accepted', 'Your document for requirement \'example\' in organization \'Society of Computer Enthusiast\' has been accepted by the Special Admin.', 'accreditation', 'unread', 1, '2026-02-07 04:37:59'),
(14, 24, 3, 'Accreditation Recommended', 'Your accreditation request for organization \'Society of Computer Enthusiast\' has been recommended by the Special Admin and is now pending Super Admin approval.', 'accreditation', 'unread', 1, '2026-02-07 06:24:12'),
(15, 3, 24, 'Organization Updated - Requires Re-review', 'Organization \'Society of Computer Enthusiast\' has been updated by tester tester. The accreditation request status has been reset to Pending for re-review.', 'reaccreditation', 'unread', 6, '2026-02-07 09:37:11'),
(16, 24, 24, 'Organization Updated', 'Your organization \'Society of Computer Enthusiast\' has been updated successfully. The accreditation request status has been reset to Pending for review.', 'reaccreditation', 'unread', 6, '2026-02-07 09:37:11'),
(17, 3, 24, 'Organization Updated - Requires Re-review', 'Organization \'Society of Computer Enthusiast\' has been updated by tester tester. The accreditation request status has been reset to Pending for re-review.', 'reaccreditation', 'unread', 6, '2026-02-07 09:37:57'),
(18, 24, 24, 'Organization Updated', 'Your organization \'Society of Computer Enthusiast\' has been updated successfully. The accreditation request status has been reset to Pending for review.', 'reaccreditation', 'unread', 6, '2026-02-07 09:37:57'),
(19, 3, 24, 'Organization Updated - Requires Re-review', 'Organization \'Society of Computer Enthusiast\' has been updated by tester tester. The accreditation request status has been reset to Pending for re-review.', 'reaccreditation', 'unread', 6, '2026-02-07 10:12:49'),
(20, 24, 24, 'Organization Updated', 'Your organization \'Society of Computer Enthusiast\' has been updated successfully. The accreditation request status has been reset to Pending for review.', 'reaccreditation', 'unread', 6, '2026-02-07 10:12:49'),
(21, 3, 24, 'Organization Updated - Requires Re-review', 'Organization \'Society of Computer Enthusiast\' has been updated by tester tester. The accreditation request status has been reset to Pending for re-review.', 'reaccreditation', 'unread', 6, '2026-02-07 10:40:43'),
(22, 24, 24, 'Organization Updated', 'Your organization \'Society of Computer Enthusiast\' has been updated successfully. The accreditation request status has been reset to Pending for review.', 'reaccreditation', 'unread', 6, '2026-02-07 10:40:43'),
(23, 3, 24, 'Organization Updated - Requires Re-review', 'Organization \'Society of Computer Enthusiast\' has been updated by tester tester. The accreditation request status has been reset to Pending for re-review.', 'reaccreditation', 'unread', 6, '2026-02-07 10:49:59'),
(24, 24, 24, 'Organization Updated', 'Your organization \'Society of Computer Enthusiast\' has been updated successfully. The accreditation request status has been reset to Pending for review.', 'reaccreditation', 'unread', 6, '2026-02-07 10:49:59'),
(25, 24, 3, 'Moderator Assigned', 'A moderator (testing tester) has been assigned to review your accreditation request for organization \'Society of Computer Enthusiast\'.', 'accreditation', 'unread', 6, '2026-02-07 11:20:23'),
(26, 24, 3, 'Document Accepted', 'Your document for requirement \'example\' in organization \'Society of Computer Enthusiast\' has been accepted by the Special Admin.', 'accreditation', 'unread', 6, '2026-02-07 13:24:55'),
(27, 24, 3, 'Documents Accepted', '2 of your documents for organization \'Society of Computer Enthusiast\' have been accepted by the Special Admin.', 'accreditation', 'unread', 6, '2026-02-07 13:58:23'),
(28, 24, 3, 'Documents Returned - Needs Revision', '2 of your documents for organization \'Society of Computer Enthusiast\' have been returned by the Special Admin. Reason: bluh blah bleh', 'accreditation', 'unread', 6, '2026-02-07 13:58:42'),
(29, 24, 3, 'Documents Accepted', '2 of your documents for organization \'Society of Computer Enthusiast\' have been accepted by the Special Admin.', 'accreditation', 'unread', 6, '2026-02-07 13:58:47'),
(30, 24, 3, 'Accreditation Recommended', 'Your accreditation request for organization \'Society of Computer Enthusiast\' has been recommended by the Special Admin and is now pending Super Admin approval.', 'accreditation', 'unread', 6, '2026-02-07 23:21:14'),
(31, 3, 24, 'Organization Updated - Requires Re-review', 'Organization \'Society of Computer Enthusiast\' has been updated by tester tester. The accreditation request status has been reset to Pending for re-review.', 'reaccreditation', 'unread', 6, '2026-02-09 02:57:34'),
(32, 24, 24, 'Organization Updated', 'Your organization \'Society of Computer Enthusiast\' has been updated successfully. The accreditation request status has been reset to Pending for review.', 'reaccreditation', 'unread', 6, '2026-02-09 02:57:34'),
(33, 24, 3, 'Document Accepted', 'Your document for requirement \'example\' in organization \'Society of Computer Enthusiast\' has been accepted by the Special Admin.', 'accreditation', 'unread', 6, '2026-02-09 03:12:13'),
(34, 24, 3, 'Document Accepted', 'Your document for requirement \'example\' in organization \'Society of Computer Enthusiast\' has been accepted by the Special Admin.', 'accreditation', 'unread', 6, '2026-02-09 03:12:24'),
(35, 24, 3, 'Document Accepted', 'Your document for requirement \'example\' in organization \'Society of Computer Enthusiast\' has been accepted by the Special Admin.', 'accreditation', 'unread', 6, '2026-02-09 03:12:32'),
(36, 24, 3, 'Document Returned - Needs Revision', 'Your document for requirement \'idk what kind of requirements is this\' in organization \'Society of Computer Enthusiast\' has been returned by the Special Admin. Reason: asdasdasd', 'accreditation', 'unread', 6, '2026-02-09 03:12:40'),
(37, 3, 24, 'Document Replaced - Requires Review', 'A document has been replaced for accreditation request #6 by tester tester. The request status has been reset to Pending.', 'accreditation', 'unread', 6, '2026-02-09 03:13:46'),
(38, 24, 24, 'Document Replaced', 'You have successfully replaced the document for requirement #2. The request status has been reset to Pending.', 'accreditation', 'unread', 6, '2026-02-09 03:13:46'),
(39, 24, 3, 'Document Accepted', 'Your document for requirement \'idk what kind of requirements is this\' in organization \'Society of Computer Enthusiast\' has been accepted by the Special Admin.', 'accreditation', 'unread', 6, '2026-02-09 03:14:02'),
(40, 24, 3, 'Accreditation Recommended', 'Your accreditation request for organization \'Society of Computer Enthusiast\' has been recommended by the Special Admin and is now pending Super Admin approval.', 'accreditation', 'read', 6, '2026-02-09 03:14:16'),
(41, 3, 24, 'Organization Updated - Requires Re-review', 'Organization \'Society of Computer Enthusiast\' has been updated by tester tester. The accreditation request status has been reset to Pending for re-review.', 'reaccreditation', 'unread', 6, '2026-02-09 06:05:28'),
(42, 24, 24, 'Organization Updated', 'Your organization \'Society of Computer Enthusiast\' has been updated successfully. The accreditation request status has been reset to Pending for review.', 'reaccreditation', 'read', 6, '2026-02-09 06:05:28'),
(43, 3, 24, 'Organization Updated - Requires Re-review', 'Organization \'Society of Computer Enthusiast\' has been updated by tester tester. The accreditation request status has been reset to Pending for re-review.', 'reaccreditation', 'unread', 6, '2026-02-09 06:06:52'),
(44, 24, 24, 'Organization Updated', 'Your organization \'Society of Computer Enthusiast\' has been updated successfully. The accreditation request status has been reset to Pending for review.', 'reaccreditation', 'read', 6, '2026-02-09 06:06:52'),
(45, 3, 24, 'Organization Updated - Requires Re-review', 'Organization \'Society of Computer Enthusiast\' has been updated by tester tester. The accreditation request status has been reset to Pending for re-review.', 'reaccreditation', 'unread', 6, '2026-02-09 06:24:07'),
(46, 24, 24, 'Organization Updated', 'Your organization \'Society of Computer Enthusiast\' has been updated successfully. The accreditation request status has been reset to Pending for review.', 'reaccreditation', 'read', 6, '2026-02-09 06:24:07'),
(47, 3, 24, 'Organization Updated - Requires Re-review', 'Organization \'Society of Computer Enthusiast\' has been updated by tester tester. The accreditation request status has been reset to Pending for re-review.', 'reaccreditation', 'unread', 6, '2026-02-09 06:24:33'),
(48, 24, 24, 'Organization Updated', 'Your organization \'Society of Computer Enthusiast\' has been updated successfully. The accreditation request status has been reset to Pending for review.', 'reaccreditation', 'read', 6, '2026-02-09 06:24:33'),
(49, 3, 24, 'Organization Updated - Requires Re-review', 'Organization \'Society of Computer Enthusiast\' has been updated by tester tester. The accreditation request status has been reset to Pending for re-review.', 'reaccreditation', 'unread', 6, '2026-02-09 06:50:31'),
(50, 24, 24, 'Organization Updated', 'Your organization \'Society of Computer Enthusiast\' has been updated successfully. The accreditation request status has been reset to Pending for review.', 'reaccreditation', 'read', 6, '2026-02-09 06:50:31'),
(51, 24, 3, 'Document Accepted', 'Your document for requirement \'example\' in organization \'Society of Computer Enthusiast\' has been accepted by the Special Admin.', 'accreditation', 'read', 6, '2026-02-09 06:51:22'),
(52, 24, 3, 'Document Accepted', 'Your document for requirement \'example\' in organization \'Society of Computer Enthusiast\' has been accepted by the Special Admin.', 'accreditation', 'read', 6, '2026-02-09 06:51:27'),
(53, 24, 3, 'Document Returned - Needs Revision', 'Your document for requirement \'idk what kind of requirements is this\' in organization \'Society of Computer Enthusiast\' has been returned by the Special Admin. Reason: asdasdasd', 'accreditation', 'read', 6, '2026-02-09 06:51:34'),
(54, 3, 24, 'Document Replaced - Requires Review', 'A document has been replaced for accreditation request #6 by tester tester. The request status has been reset to Pending.', 'accreditation', 'unread', 6, '2026-02-09 06:52:16'),
(55, 24, 24, 'Document Replaced', 'You have successfully replaced the document for requirement #2. The request status has been reset to Pending.', 'accreditation', 'read', 6, '2026-02-09 06:52:16'),
(56, 24, 3, 'Document Accepted', 'Your document for requirement \'idk what kind of requirements is this\' in organization \'Society of Computer Enthusiast\' has been accepted by the Special Admin.', 'accreditation', 'read', 6, '2026-02-09 06:52:34'),
(57, 24, 3, 'Accreditation Recommended', 'Your accreditation request for organization \'Society of Computer Enthusiast\' has been recommended by the Special Admin and is now pending Super Admin approval.', 'accreditation', 'read', 6, '2026-02-09 07:10:34'),
(58, 24, 3, 'Accreditation Recommended', 'Your accreditation request for organization \'Society of Computer Enthusiast\' has been recommended by the Special Admin and is now pending Super Admin approval.', 'accreditation', 'read', 6, '2026-02-09 07:10:35'),
(59, 24, 4, 'Accreditation Activated', 'Your accreditation request for organization \'Society of Computer Enthusiast\' has been activated and is now officially recognized.', 'accreditation', 'read', 6, '2026-02-09 14:16:13'),
(60, 25, 4, 'Accreditation Activated', 'Accreditation for \'Society of Computer Enthusiast\' is now Active.', 'accreditation', 'unread', 6, '2026-02-09 14:16:13'),
(61, 3, 4, 'Accreditation Activated', 'Accreditation for \'Society of Computer Enthusiast\' is now Active.', 'accreditation', 'unread', 6, '2026-02-09 14:16:13'),
(62, 24, 4, 'Accreditation Activated', 'Your accreditation request for organization \'Society of Computer Enthusiast\' has been activated and is now officially recognized.', 'accreditation', 'read', 6, '2026-02-09 14:31:37'),
(63, 25, 4, 'Accreditation Activated', 'Accreditation for \'Society of Computer Enthusiast\' is now Active.', 'accreditation', 'unread', 6, '2026-02-09 14:31:37'),
(64, 3, 4, 'Accreditation Activated', 'Accreditation for \'Society of Computer Enthusiast\' is now Active.', 'accreditation', 'read', 6, '2026-02-09 14:31:37'),
(71, 24, 4, 'Accreditation Activated', 'Your accreditation request for organization \'Society of Computer Enthusiast\' has been activated and is now officially recognized.', 'accreditation', 'read', 6, '2026-02-09 17:33:34'),
(72, 25, 4, 'Accreditation Activated', 'Accreditation for \'Society of Computer Enthusiast\' is now Active.', 'accreditation', 'unread', 6, '2026-02-09 17:33:34'),
(73, 3, 4, 'Accreditation Activated', 'Accreditation for \'Society of Computer Enthusiast\' is now Active.', 'accreditation', 'read', 6, '2026-02-09 17:33:34'),
(74, 24, 4, 'Accreditation Activated', 'Your accreditation request for organization \'Society of Computer Enthusiast\' has been activated and is now officially recognized.', 'accreditation', 'read', 6, '2026-02-09 21:50:21'),
(75, 25, 4, 'Accreditation Activated', 'Accreditation for \'Society of Computer Enthusiast\' is now Active.', 'accreditation', 'unread', 6, '2026-02-09 21:50:21'),
(76, 3, 4, 'Accreditation Activated', 'Accreditation for \'Society of Computer Enthusiast\' is now Active.', 'accreditation', 'read', 6, '2026-02-09 21:50:21'),
(77, 3, 28, 'New Accreditation Request Submitted', 'A new accreditation request for organization \'Ball Club\' has been submitted by buns buns.', 'accreditation', 'read', 7, '2026-02-10 01:52:46'),
(78, 28, 28, 'Accreditation Request Submitted', 'Your accreditation request for \'Ball Club\' has been submitted successfully and is now pending review.', 'accreditation', 'unread', 7, '2026-02-10 01:52:46'),
(79, 28, 3, 'Moderator Assigned', 'A moderator (mods mods) has been assigned to review your accreditation request for organization \'Ball Club\'.', 'accreditation', 'unread', 7, '2026-02-10 02:00:37'),
(80, 28, 3, 'Documents Accepted', '2 of your documents for organization \'Ball Club\' have been accepted by the Special Admin.', 'accreditation', 'unread', 7, '2026-02-10 02:00:44'),
(81, 28, 4, 'Accreditation Activated', 'Your accreditation request for organization \'Ball Club\' has been activated and is now officially recognized.', 'accreditation', 'unread', 7, '2026-02-10 02:02:09'),
(82, 29, 4, 'Accreditation Activated', 'Accreditation for \'Ball Club\' is now Active.', 'accreditation', 'unread', 7, '2026-02-10 02:02:09'),
(83, 3, 4, 'Accreditation Activated', 'Accreditation for \'Ball Club\' is now Active.', 'accreditation', 'read', 7, '2026-02-10 02:02:09'),
(84, 3, 24, 'Organization Updated - Requires Re-review', 'Organization \'Society of Computer Enthusiast\' has been updated by tester tester. The accreditation request status has been reset to Pending for re-review.', 'reaccreditation', 'read', 6, '2026-02-11 03:37:34'),
(85, 24, 24, 'Organization Updated', 'Your organization \'Society of Computer Enthusiast\' has been updated successfully. The accreditation request status has been reset to Pending for review.', 'reaccreditation', 'read', 6, '2026-02-11 03:37:34'),
(86, 24, 3, 'Documents Accepted', '2 of your documents for organization \'Society of Computer Enthusiast\' have been accepted by the Special Admin.', 'accreditation', 'read', 6, '2026-02-11 03:37:54'),
(87, 24, 4, 'Accreditation Activated', 'Your accreditation request for organization \'Society of Computer Enthusiast\' has been activated and is now officially recognized.', 'accreditation', 'read', 6, '2026-02-11 03:38:29'),
(88, 25, 4, 'Accreditation Activated', 'Accreditation for \'Society of Computer Enthusiast\' is now Active.', 'accreditation', 'unread', 6, '2026-02-11 03:38:29'),
(89, 3, 4, 'Accreditation Activated', 'Accreditation for \'Society of Computer Enthusiast\' is now Active.', 'accreditation', 'read', 6, '2026-02-11 03:38:29'),
(90, 3, 36, 'New Accreditation Request Submitted', 'A new accreditation request for organization \'The Cache\' has been submitted by testing test.', 'accreditation', 'read', 8, '2026-02-14 11:38:49'),
(91, 36, 36, 'Accreditation Request Submitted', 'Your accreditation request for \'The Cache\' has been submitted successfully and is now pending review.', 'accreditation', 'unread', 8, '2026-02-14 11:38:49'),
(92, 7, 24, 'Testing Testing this should be so interesting', 'Test', 'announcement', 'read', 1, '2026-02-21 07:26:51'),
(93, 36, 3, 'Recommendation Submitted', 'A recommendation letter for \'The Cache\' has been generated and your request is now marked as Recommended.', 'accreditation', 'unread', 8, '2026-02-26 00:33:51'),
(94, 4, 3, 'Accreditation Ready for Activation', 'Recommendation submitted for \'The Cache\' (2026-2027 • 1st). Request #8 is now Recommended and pending your activation.', 'accreditation', 'read', 8, '2026-02-26 00:33:51'),
(95, 36, 4, 'Accreditation Activated', 'Your accreditation request for organization \'The Cache\' is now Active.', 'accreditation', 'unread', 8, '2026-02-26 01:23:01'),
(96, 4, 4, 'test', 'test', 'announcement', 'read', 2, '2026-02-26 02:03:14'),
(97, 31, 31, 'Organization Fee Payment Recorded', 'Your organization fee payment has been recorded. Receipt: ORG1-T4-20260228-856BED86. Amount: 100.00', '', 'read', 4, '2026-02-28 01:03:44'),
(98, 36, 3, 'Recommendation Submitted', 'A recommendation letter for \'The Cache\' has been generated and your request is now marked as Recommended.', 'accreditation', 'unread', 8, '2026-03-03 06:25:58'),
(99, 4, 3, 'Accreditation Ready for Activation', 'Recommendation submitted for \'The Cache\' (2026-2027 • 1st). Request #8 is now Recommended and pending your activation.', 'accreditation', 'read', 8, '2026-03-03 06:25:58'),
(100, 7, 22, 'New join request: Ball Club', 'final test test test (2022303895) submitted a join request.', 'club', 'read', 7, '2026-03-03 21:55:20'),
(101, 8, 22, 'New join request: Ball Club', 'final test test test (2022303895) submitted a join request.', 'club', 'unread', 7, '2026-03-03 21:55:20'),
(102, 9, 22, 'New join request: Ball Club', 'final test test test (2022303895) submitted a join request.', 'club', 'unread', 7, '2026-03-03 21:55:22'),
(103, 26, 22, 'New join request: Ball Club', 'final test test test (2022303895) submitted a join request.', 'club', 'unread', 7, '2026-03-03 21:55:22'),
(104, 27, 22, 'New join request: Ball Club', 'final test test test (2022303895) submitted a join request.', 'club', 'unread', 7, '2026-03-03 21:55:22'),
(105, 28, 22, 'New join request: Ball Club', 'final test test test (2022303895) submitted a join request.', 'club', 'unread', 7, '2026-03-03 21:55:22'),
(106, 29, 22, 'New join request: Ball Club', 'final test test test (2022303895) submitted a join request.', 'club', 'unread', 7, '2026-03-03 21:55:22'),
(107, 22, 7, 'Membership activated: Ball Club', 'Karl Isiah Bagaipo Poloyapoy (2022303890) activated your membership.', 'club', 'read', 6, '2026-03-03 22:06:20'),
(108, 34, 31, 'Organization Fee Payment Recorded', 'Your organization fee payment has been recorded. Receipt: ORG1-T4-20260304-3DFFF101. Amount: 100.00', 'payment', 'unread', 5, '2026-03-04 00:03:37'),
(109, 32, 31, 'Organization Fee Payment Recorded', 'Your organization fee payment has been recorded. Receipt: 1234567890. Amount: 100.00', 'payment', 'unread', 6, '2026-03-04 01:38:24'),
(110, 7, 34, 'New join request: Ball Club', 'lorem ipsum4 (123456) submitted a join request.', 'club', 'read', 8, '2026-03-04 01:41:21'),
(111, 8, 34, 'New join request: Ball Club', 'lorem ipsum4 (123456) submitted a join request.', 'club', 'unread', 8, '2026-03-04 01:41:21'),
(112, 9, 34, 'New join request: Ball Club', 'lorem ipsum4 (123456) submitted a join request.', 'club', 'unread', 8, '2026-03-04 01:41:21'),
(113, 26, 34, 'New join request: Ball Club', 'lorem ipsum4 (123456) submitted a join request.', 'club', 'unread', 8, '2026-03-04 01:41:21'),
(114, 27, 34, 'New join request: Ball Club', 'lorem ipsum4 (123456) submitted a join request.', 'club', 'unread', 8, '2026-03-04 01:41:21'),
(115, 28, 34, 'New join request: Ball Club', 'lorem ipsum4 (123456) submitted a join request.', 'club', 'unread', 8, '2026-03-04 01:41:21'),
(116, 29, 34, 'New join request: Ball Club', 'lorem ipsum4 (123456) submitted a join request.', 'club', 'unread', 8, '2026-03-04 01:41:21'),
(117, 34, 7, 'Membership activated: Ball Club', 'Karl Isiah Bagaipo Poloyapoy (2022303890) activated your membership.', 'club', 'unread', 7, '2026-03-04 01:44:02'),
(118, 3, 24, 'Organization Updated - Requires Re-review', 'Organization \'Society of Computer Enthusiast\' has been updated by tester tester. The accreditation request status has been reset to Pending for re-review.', 'reaccreditation', 'unread', 6, '2026-03-04 02:34:39'),
(119, 24, 24, 'Organization Updated', 'Your organization \'Society of Computer Enthusiast\' has been updated successfully. The accreditation request status has been reset to Pending for review.', 'reaccreditation', 'read', 6, '2026-03-04 02:34:39'),
(120, 24, 3, 'Documents Accepted', '3 of your documents for organization \'Society of Computer Enthusiast\' have been accepted by the Special Admin.', 'accreditation', 'unread', 6, '2026-03-04 02:36:13'),
(121, 24, 3, 'Recommendation Submitted', 'A recommendation letter for \'Society of Computer Enthusiast\' has been generated and your request is now marked as Recommended.', 'accreditation', 'unread', 6, '2026-03-04 02:36:21'),
(122, 4, 3, 'Accreditation Ready for Activation', 'Recommendation submitted for \'Society of Computer Enthusiast\' (2026-2027 • 1st). Request #6 is now Recommended and pending your activation.', 'accreditation', 'read', 6, '2026-03-04 02:36:21'),
(123, 24, 3, 'Recommendation Submitted', 'A recommendation letter for \'Society of Computer Enthusiast\' has been generated and your request is now marked as Recommended.', 'accreditation', 'unread', 6, '2026-03-04 02:36:23'),
(124, 4, 3, 'Accreditation Ready for Activation', 'Recommendation submitted for \'Society of Computer Enthusiast\' (2026-2027 • 1st). Request #6 is now Recommended and pending your activation.', 'accreditation', 'read', 6, '2026-03-04 02:36:23'),
(125, 24, 4, 'Accreditation Activated', 'Your accreditation request for organization \'Society of Computer Enthusiast\' is now Active.', 'accreditation', 'unread', 6, '2026-03-04 02:37:02'),
(126, 3, 24, 'Organization Updated - Requires Re-review', 'Organization \'Society of Computer Enthusiast\' has been updated by tester tester. The accreditation request status has been reset to Pending for re-review.', 'reaccreditation', 'unread', 6, '2026-03-04 02:46:13'),
(127, 24, 24, 'Organization Updated', 'Your organization \'Society of Computer Enthusiast\' has been updated successfully. The accreditation request status has been reset to Pending for review.', 'reaccreditation', 'unread', 6, '2026-03-04 02:46:13'),
(128, 24, 3, 'Document Accepted', 'Your document for requirement \'rename\' in organization \'Society of Computer Enthusiast\' has been accepted by the Special Admin.', 'accreditation', 'unread', 6, '2026-03-04 02:47:31'),
(129, 24, 3, 'Documents Accepted', '3 of your documents for organization \'Society of Computer Enthusiast\' have been accepted by the Special Admin.', 'accreditation', 'unread', 6, '2026-03-04 02:47:40'),
(130, 24, 3, 'Recommendation Submitted', 'A recommendation letter for \'Society of Computer Enthusiast\' has been generated and your request is now marked as Recommended.', 'accreditation', 'unread', 6, '2026-03-04 02:47:57'),
(131, 4, 3, 'Accreditation Ready for Activation', 'Recommendation submitted for \'Society of Computer Enthusiast\' (2026-2027 • 1st). Request #6 is now Recommended and pending your activation.', 'accreditation', 'read', 6, '2026-03-04 02:47:57'),
(132, 24, 4, 'Accreditation Activated', 'Your accreditation request for organization \'Society of Computer Enthusiast\' has been activated and is now officially recognized.', 'accreditation', 'unread', 6, '2026-03-04 02:48:36'),
(133, 25, 4, 'Accreditation Activated', 'Accreditation for \'Society of Computer Enthusiast\' is now Active.', 'accreditation', 'unread', 6, '2026-03-04 02:48:36'),
(134, 3, 4, 'Accreditation Activated', 'Accreditation for \'Society of Computer Enthusiast\' is now Active.', 'accreditation', 'unread', 6, '2026-03-04 02:48:36'),
(135, 3, 24, 'Organization Updated - Requires Re-review', 'Organization \'Society of Computer Enthusiast\' has been updated by tester tester. The accreditation request status has been reset to Pending for re-review.', 'reaccreditation', 'unread', 6, '2026-03-04 03:03:08'),
(136, 24, 24, 'Organization Updated', 'Your organization \'Society of Computer Enthusiast\' has been updated successfully. The accreditation request status has been reset to Pending for review.', 'reaccreditation', 'read', 6, '2026-03-04 03:03:08'),
(137, 24, 3, 'Documents Accepted', '3 of your documents for organization \'Society of Computer Enthusiast\' have been accepted by the Special Admin.', 'accreditation', 'unread', 6, '2026-03-04 03:03:46'),
(138, 24, 3, 'Recommendation Submitted', 'A recommendation letter for \'Society of Computer Enthusiast\' has been generated and your request is now marked as Recommended.', 'accreditation', 'unread', 6, '2026-03-04 03:04:04'),
(139, 4, 3, 'Accreditation Ready for Activation', 'Recommendation submitted for \'Society of Computer Enthusiast\' (2026-2027 • 1st). Request #6 is now Recommended and pending your activation.', 'accreditation', 'read', 6, '2026-03-04 03:04:04'),
(140, 24, 4, 'Accreditation Activated', 'Your accreditation request for organization \'Society of Computer Enthusiast\' is now Active.', 'accreditation', 'read', 6, '2026-03-04 03:04:40'),
(141, 26, 31, 'Unpaid Organization Fee Reminder', 'You still have an unpaid organization fee for Society of Computer Enthusiast. Please settle it with your organization officer.', 'general', 'read', NULL, '2026-03-04 04:10:20'),
(142, 4, 38, 'New registration pending approval', 'User 69 (Balls Balls) has registered and is pending approval.', 'registration', 'read', NULL, '2026-03-04 05:41:31'),
(143, 26, 31, 'Unpaid Organization Fee Reminder', 'You still have an unpaid organization fee for Society of Computer Enthusiast. Please settle it with your organization officer.', 'general', 'read', NULL, '2026-03-04 08:34:38'),
(144, 24, 31, 'Accomplishment Report Submitted', 'Accomplishment report for event \'testing na sad\' has been submitted for review by lorem ipsum.', '', 'read', 10, '2026-03-06 01:46:08'),
(145, 24, 31, 'Accomplishment Report Submitted', 'Accomplishment report for event \'final testing\' has been submitted for review by lorem ipsum.', '', 'unread', 12, '2026-03-06 02:07:33'),
(146, 24, 31, 'Accomplishment Report Submitted', 'Accomplishment report for event \'test\' has been submitted for review by lorem ipsum.', '', 'read', 6, '2026-03-06 03:10:30'),
(147, 24, 31, 'Accomplishment Report Submitted', 'Accomplishment report for event \'thesis expenses\' has been submitted for review by lorem ipsum.', '', 'read', 14, '2026-03-06 03:44:16'),
(148, 24, 31, 'Accomplishment Report Submitted', 'Accomplishment report for event \'ambot lang\' has been submitted for review by lorem ipsum.', '', 'read', 4, '2026-03-06 03:45:28'),
(149, 24, 31, 'Accomplishment Report Submitted', 'Accomplishment report for event \'IT Days\' has been submitted for review by lorem ipsum.', '', 'read', 15, '2026-03-06 03:59:26'),
(150, 39, 37, 'New Accreditation Request Submitted', 'A new accreditation request for organization \'Rotaract\' has been submitted by admin admin.', 'accreditation', 'read', 9, '2026-03-06 07:04:56'),
(151, 37, 37, 'Accreditation Request Submitted', 'Your accreditation request for \'Rotaract\' has been submitted successfully and is now pending review.', 'accreditation', 'unread', 9, '2026-03-06 07:04:56'),
(152, 39, 37, 'Organization Updated - Requires Re-review', 'Organization \'Rotaract\' has been updated by admin admin. The accreditation request status has been reset to Pending for re-review.', 'reaccreditation', 'read', 9, '2026-03-06 07:09:20'),
(153, 37, 37, 'Organization Updated', 'Your organization \'Rotaract\' has been updated successfully. The accreditation request status has been reset to Pending for review.', 'reaccreditation', 'unread', 9, '2026-03-06 07:09:20'),
(154, 7, 31, 'Unpaid Organization Fee Reminder', 'You still have an unpaid organization fee for Society of Computer Enthusiast. Please settle it with your organization officer.', 'general', 'read', NULL, '2026-03-08 08:11:17'),
(155, 26, 31, 'Unpaid Organization Fee Reminder', 'You still have an unpaid organization fee for Society of Computer Enthusiast. Please settle it with your organization officer.', 'general', 'unread', NULL, '2026-03-08 10:39:57'),
(156, 7, 31, 'Unpaid Organization Fee Reminder', 'You still have an unpaid organization fee for Society of Computer Enthusiast. Please settle it with your organization officer.', 'general', 'read', NULL, '2026-03-08 10:40:04'),
(157, 39, 24, 'Organization Updated', 'Organization \'Society of Computer Enthusiast\' updated by tester tester.', 'reaccreditation', 'read', 6, '2026-03-08 11:02:58'),
(158, 24, 24, 'Organization Updated', 'Your organization \'Society of Computer Enthusiast\' has been updated successfully.', 'reaccreditation', 'unread', 6, '2026-03-08 11:02:58'),
(159, 24, 39, 'Document Accepted', 'Your document for requirement \'sample 1\' in organization \'Society of Computer Enthusiast\' has been accepted.', 'accreditation', 'unread', 6, '2026-03-08 11:03:47'),
(160, 24, 39, 'Documents Accepted', 'Your submitted documents for organization \'Society of Computer Enthusiast\' have been accepted.', 'accreditation', 'unread', 6, '2026-03-08 11:03:55'),
(161, 24, 39, 'Recommendation Submitted', 'A recommendation letter for \'Society of Computer Enthusiast\' has been generated and your request is now marked as Recommended.', 'accreditation', 'unread', 6, '2026-03-08 11:04:55'),
(162, 4, 39, 'Accreditation Ready for Activation', 'Recommendation submitted for \'Society of Computer Enthusiast\' (2026-2027 • 1st). Request #6 is now Recommended and pending your activation.', 'accreditation', 'read', 6, '2026-03-08 11:04:55'),
(163, 24, 4, 'Accreditation Activated', 'Your accreditation request for organization \'Society of Computer Enthusiast\' has been activated and is now officially recognized.', 'accreditation', 'unread', 6, '2026-03-08 11:05:33'),
(164, 25, 4, 'Accreditation Activated', 'Accreditation for \'Society of Computer Enthusiast\' is now Active.', 'accreditation', 'unread', 6, '2026-03-08 11:05:33'),
(165, 39, 4, 'Accreditation Activated', 'Accreditation for \'Society of Computer Enthusiast\' is now Active.', 'accreditation', 'unread', 6, '2026-03-08 11:05:33'),
(166, 36, 4, 'Accreditation Activated', 'Your accreditation request for organization \'The Cache\' has been activated and is now officially recognized.', 'accreditation', 'unread', 8, '2026-03-08 11:13:38'),
(167, 39, 4, 'Accreditation Activated', 'Accreditation for \'The Cache\' is now Active.', 'accreditation', 'read', 8, '2026-03-08 11:13:38'),
(168, 39, 24, 'Organization Updated', 'Organization \'Society of Computer Enthusiast\' updated by tester tester.', 'reaccreditation', 'read', 6, '2026-03-08 11:26:29'),
(169, 24, 24, 'Organization Updated', 'Your organization \'Society of Computer Enthusiast\' has been updated successfully.', 'reaccreditation', 'unread', 6, '2026-03-08 11:26:29'),
(170, 24, 39, 'Documents Accepted', 'Your submitted documents for organization \'Society of Computer Enthusiast\' have been accepted.', 'accreditation', 'unread', 6, '2026-03-08 11:28:26'),
(171, 24, 39, 'Recommendation Submitted', 'A recommendation letter for \'Society of Computer Enthusiast\' has been generated and your request is now marked as Recommended.', 'accreditation', 'unread', 6, '2026-03-08 11:28:34'),
(172, 4, 39, 'Accreditation Ready for Activation', 'Recommendation submitted for \'Society of Computer Enthusiast\' (2026-2027 • 1st). Request #6 is now Recommended and pending your activation.', 'accreditation', 'read', 6, '2026-03-08 11:28:34'),
(173, 24, 4, 'Accreditation Activated', 'Your accreditation request for organization \'Society of Computer Enthusiast\' has been activated and is now officially recognized.', 'accreditation', 'unread', 6, '2026-03-08 11:29:10'),
(174, 25, 4, 'Accreditation Activated', 'Accreditation for \'Society of Computer Enthusiast\' is now Active.', 'accreditation', 'unread', 6, '2026-03-08 11:29:10'),
(175, 39, 4, 'Accreditation Activated', 'Accreditation for \'Society of Computer Enthusiast\' is now Active.', 'accreditation', 'read', 6, '2026-03-08 11:29:10'),
(176, 39, 24, 'Organization Updated', 'Organization \'Society of Computer Enthusiast\' updated by tester tester.', 'reaccreditation', 'read', 6, '2026-03-08 11:41:58'),
(177, 24, 24, 'Organization Updated', 'Your organization \'Society of Computer Enthusiast\' has been updated successfully.', 'reaccreditation', 'unread', 6, '2026-03-08 11:41:58'),
(178, 24, 39, 'Recommendation Submitted', 'A recommendation letter for \'Society of Computer Enthusiast\' has been generated and your request is now marked as Recommended.', 'accreditation', 'unread', 6, '2026-03-08 12:00:56'),
(179, 4, 39, 'Accreditation Ready for Activation', 'Recommendation submitted for \'Society of Computer Enthusiast\' (2026-2027 • 1st). Request #6 is now Recommended and pending your activation.', 'accreditation', 'read', 6, '2026-03-08 12:00:56'),
(180, 24, 4, 'Accreditation Activated', 'Your accreditation request for organization \'Society of Computer Enthusiast\' has been activated and is now officially recognized.', 'accreditation', 'unread', 6, '2026-03-08 12:01:08'),
(181, 25, 4, 'Accreditation Activated', 'Accreditation for \'Society of Computer Enthusiast\' is now Active.', 'accreditation', 'unread', 6, '2026-03-08 12:01:08'),
(182, 39, 4, 'Accreditation Activated', 'Accreditation for \'Society of Computer Enthusiast\' is now Active.', 'accreditation', 'unread', 6, '2026-03-08 12:01:08'),
(183, 39, 24, 'Organization Updated', 'Organization \'Society of Computer Enthusiast\' updated by tester tester.', 'reaccreditation', 'read', 6, '2026-03-08 12:04:48'),
(184, 24, 24, 'Organization Updated', 'Your organization \'Society of Computer Enthusiast\' has been updated successfully.', 'reaccreditation', 'unread', 6, '2026-03-08 12:04:48'),
(185, 24, 39, 'Recommendation Submitted', 'A recommendation letter for \'Society of Computer Enthusiast\' has been generated and your request is now marked as Recommended.', 'accreditation', 'unread', 6, '2026-03-08 12:05:13'),
(186, 4, 39, 'Accreditation Ready for Activation', 'Recommendation submitted for \'Society of Computer Enthusiast\' (2026-2027 • 1st). Request #6 is now Recommended and pending your activation.', 'accreditation', 'unread', 6, '2026-03-08 12:05:13'),
(187, 24, 4, 'Accreditation Activated', 'Your accreditation request for organization \'Society of Computer Enthusiast\' has been activated and is now officially recognized.', 'accreditation', 'unread', 6, '2026-03-08 12:05:38'),
(188, 25, 4, 'Accreditation Activated', 'Accreditation for \'Society of Computer Enthusiast\' is now Active.', 'accreditation', 'unread', 6, '2026-03-08 12:05:38'),
(189, 39, 4, 'Accreditation Activated', 'Accreditation for \'Society of Computer Enthusiast\' is now Active.', 'accreditation', 'read', 6, '2026-03-08 12:05:38'),
(190, 24, 39, 'Recommendation Submitted', 'A recommendation letter for \'Society of Computer Enthusiast\' has been generated and your request is now marked as Recommended.', 'accreditation', 'unread', 6, '2026-03-08 12:10:20'),
(191, 4, 39, 'Accreditation Ready for Activation', 'Recommendation submitted for \'Society of Computer Enthusiast\' (2026-2027 • 1st). Request #6 is now Recommended and pending your activation.', 'accreditation', 'read', 6, '2026-03-08 12:10:20'),
(192, 24, 4, 'Accreditation Activated', 'Your accreditation request for organization \'Society of Computer Enthusiast\' has been activated and is now officially recognized.', 'accreditation', 'unread', 6, '2026-03-08 12:10:35'),
(193, 25, 4, 'Accreditation Activated', 'Accreditation for \'Society of Computer Enthusiast\' is now Active.', 'accreditation', 'unread', 6, '2026-03-08 12:10:35'),
(194, 39, 4, 'Accreditation Activated', 'Accreditation for \'Society of Computer Enthusiast\' is now Active.', 'accreditation', 'read', 6, '2026-03-08 12:10:35'),
(195, 39, 41, 'New Accreditation Request Submitted', 'A new accreditation request for organization \'test\' has been submitted by tester1 tester2.', 'accreditation', 'read', 11, '2026-03-09 07:05:09'),
(196, 41, 41, 'Accreditation Request Submitted', 'Your accreditation request for \'test\' has been submitted successfully and is now pending review.', 'accreditation', 'read', 11, '2026-03-09 07:05:09'),
(197, 39, 41, 'Organization Updated', 'Organization \'test\' updated by tester1 tester2.', 'reaccreditation', 'unread', 11, '2026-03-09 07:08:09'),
(198, 41, 41, 'Organization Updated', 'Your organization \'test\' has been updated successfully.', 'reaccreditation', 'read', 11, '2026-03-09 07:08:09'),
(199, 39, 41, 'New Accreditation Request Submitted', 'A new accreditation request for organization \'tester\' has been submitted by tester1 tester2.', 'accreditation', 'read', 12, '2026-03-09 07:25:52'),
(200, 41, 41, 'Accreditation Request Submitted', 'Your accreditation request for \'tester\' has been submitted successfully and is now pending review.', 'accreditation', 'read', 12, '2026-03-09 07:25:52'),
(201, 24, 31, 'Accomplishment Report Submitted', 'Accomplishment report for event \'relogic test\' has been submitted for review by lorem ipsum.', 'accomplishment', 'unread', 1, '2026-03-12 05:24:08'),
(202, 24, 31, 'Accomplishment Report Submitted', 'Accomplishment report for event \'final relogic test\' has been submitted for review by lorem ipsum.', 'accomplishment', 'unread', 2, '2026-03-12 05:51:36'),
(203, 41, 39, 'Document Accepted', 'Your document for requirement \'sample 1\' in organization \'tester\' has been accepted.', 'accreditation', 'read', 12, '2026-03-13 01:25:54'),
(204, 41, 39, 'Document Accepted', 'Your document for requirement \'sample 1\' in organization \'tester\' has been accepted.', 'accreditation', 'read', 12, '2026-03-13 01:26:06'),
(205, 41, 39, 'Document Accepted', 'Your document for requirement \'sample 2\' in organization \'tester\' has been accepted.', 'accreditation', 'read', 12, '2026-03-13 01:26:10'),
(206, 41, 39, 'Document Accepted', 'Your document for requirement \'sample 3\' in organization \'tester\' has been accepted.', 'accreditation', 'read', 12, '2026-03-13 01:26:15'),
(207, 24, 39, 'Document Accepted', 'Your document for requirement \'sample 1\' in organization \'Society of Computer Enthusiast\' has been accepted.', 'accreditation', 'unread', 6, '2026-03-13 02:02:12'),
(208, 24, 39, 'Documents Accepted', 'Your submitted documents for organization \'Society of Computer Enthusiast\' have been accepted.', 'accreditation', 'unread', 6, '2026-03-13 02:02:16'),
(209, 7, 4, 'this is a targeted announcement', 'targeted announcement to Karl: Notice this is a targeted announcement the person being targeted in question is Karl', 'announcement', 'read', 9, '2026-03-15 04:46:32'),
(210, 39, 7, 'Organization Updated', 'Organization \'Ball Club\' updated by Karl Isiah Poloyapoy.', 'reaccreditation', 'unread', 7, '2026-03-15 07:02:52'),
(211, 24, 7, 'Organization Updated', 'Organization \'Ball Club\' has been updated by the organization president.', 'reaccreditation', 'unread', 7, '2026-03-15 07:02:52'),
(212, 7, 7, 'Organization Updated', 'Your organization \'Ball Club\' has been updated successfully.', 'reaccreditation', 'read', 7, '2026-03-15 07:02:52'),
(213, 39, 7, 'New Accreditation Request Submitted', 'A new accreditation request for organization \'test2\' has been submitted by Karl Isiah Poloyapoy.', 'accreditation', 'read', 13, '2026-03-15 07:31:09'),
(214, 24, 7, 'Accreditation Request Submitted', 'A new accreditation request for \'test2\' has been submitted and assigned to you as coordinator.', 'accreditation', 'unread', 13, '2026-03-15 07:31:09'),
(215, 7, 7, 'Accreditation Request Submitted', 'Your accreditation request for \'test2\' has been submitted successfully and is now pending review.', 'accreditation', 'read', 13, '2026-03-15 07:31:09'),
(216, 24, 39, 'Document Accepted', 'Your document for requirement \'sample 1\' in organization \'test2\' has been accepted.', 'accreditation', 'unread', 13, '2026-03-15 08:09:30'),
(217, 24, 39, 'Document Accepted', 'Your document for requirement \'sample 2\' in organization \'test2\' has been accepted.', 'accreditation', 'unread', 13, '2026-03-15 08:09:33'),
(218, 24, 39, 'Document Accepted', 'Your document for requirement \'sample 3\' in organization \'test2\' has been accepted.', 'accreditation', 'unread', 13, '2026-03-15 08:09:35'),
(219, 24, 39, 'Recommendation Submitted', 'A recommendation letter for \'test2\' has been generated and your request is now marked as Recommended.', 'accreditation', 'unread', 13, '2026-03-15 08:09:40'),
(220, 4, 39, 'Accreditation Ready for Activation', 'Recommendation submitted for \'test2\' (2026-2027 • 2nd). Request #13 is now Recommended and pending your activation.', 'accreditation', 'read', 13, '2026-03-15 08:09:40'),
(221, 24, 4, 'Accreditation Activated', 'Your accreditation request for organization \'test2\' is now Active.', 'accreditation', 'unread', 13, '2026-03-15 08:09:58'),
(222, 24, 39, 'Document Accepted', 'Your document for requirement \'sample 3\' in organization \'Society of Computer Enthusiast\' has been accepted by the Special Admin.', 'accreditation', 'unread', 6, '2026-03-15 08:12:06'),
(223, 24, 39, 'Recommendation Submitted', 'A recommendation letter for \'Society of Computer Enthusiast\' has been generated and your request is now marked as Recommended.', 'accreditation', 'unread', 6, '2026-03-15 08:12:17'),
(224, 4, 39, 'Accreditation Ready for Activation', 'Recommendation submitted for \'Society of Computer Enthusiast\' (2026-2027). Request #6 is now Recommended and pending your activation.', 'accreditation', 'unread', 6, '2026-03-15 08:12:17'),
(225, 24, 39, 'Recommendation Submitted', 'A recommendation letter for \'Society of Computer Enthusiast\' has been generated and your request is now marked as Recommended.', 'accreditation', 'unread', 6, '2026-03-15 08:12:19'),
(226, 4, 39, 'Accreditation Ready for Activation', 'Recommendation submitted for \'Society of Computer Enthusiast\' (2026-2027). Request #6 is now Recommended and pending your activation.', 'accreditation', 'read', 6, '2026-03-15 08:12:19'),
(227, 24, 4, 'Accreditation Activated', 'Your accreditation request for organization \'Society of Computer Enthusiast\' is now Active.', 'accreditation', 'unread', 6, '2026-03-15 08:13:52'),
(228, 24, 39, 'Document Accepted', 'Your document for requirement \'sample 1\' in organization \'Ball Club\' has been accepted by the Special Admin.', 'accreditation', 'unread', 7, '2026-03-15 08:49:27'),
(229, 24, 39, 'Documents Accepted', '4 of your documents for organization \'Ball Club\' have been accepted by the Special Admin.', 'accreditation', 'unread', 7, '2026-03-15 08:49:34'),
(230, 24, 39, 'Recommendation Submitted', 'A recommendation letter for \'Ball Club\' has been generated and your request is now marked as Recommended.', 'accreditation', 'unread', 7, '2026-03-15 08:49:38'),
(231, 4, 39, 'Accreditation Ready for Activation', 'Recommendation submitted for \'Ball Club\' (2026-2027). Request #7 is now Recommended and pending your activation.', 'accreditation', 'read', 7, '2026-03-15 08:49:38'),
(232, 24, 39, 'Recommendation Submitted', 'A recommendation letter for \'Ball Club\' has been generated and your request is now marked as Recommended.', 'accreditation', 'unread', 7, '2026-03-15 08:49:40'),
(233, 4, 39, 'Accreditation Ready for Activation', 'Recommendation submitted for \'Ball Club\' (2026-2027). Request #7 is now Recommended and pending your activation.', 'accreditation', 'read', 7, '2026-03-15 08:49:40'),
(234, 24, 4, 'Accreditation Activated', 'Your accreditation request for organization \'Ball Club\' is now Active.', 'accreditation', 'unread', 7, '2026-03-15 08:50:01'),
(235, 39, 7, 'Organization Updated', 'Organization \'test2\' updated by Karl Isiah Poloyapoy.', 'reaccreditation', 'unread', 13, '2026-03-15 09:08:06'),
(236, 24, 7, 'Organization Updated', 'Organization \'test2\' has been updated by the organization president.', 'reaccreditation', 'unread', 13, '2026-03-15 09:08:06'),
(237, 7, 7, 'Organization Updated', 'Your organization \'test2\' has been updated successfully.', 'reaccreditation', 'read', 13, '2026-03-15 09:08:06'),
(238, 24, 31, 'Accomplishment Report Submitted', 'Accomplishment report for event \'ambot lang\' has been submitted for review by lorem ipsum.', 'accomplishment', 'unread', 3, '2026-03-17 08:49:08'),
(239, 24, 39, 'Recommendation Submitted', 'A recommendation letter for \'test2\' has been generated and your request is now marked as Recommended.', 'accreditation', 'unread', 13, '2026-03-18 03:34:45'),
(240, 4, 39, 'Accreditation Ready for Activation', 'Recommendation submitted for \'test2\' (2026-2027). Request #13 is now Recommended and pending your activation.', 'accreditation', 'unread', 13, '2026-03-18 03:34:45'),
(241, 24, 4, 'Accreditation Activated', 'Your accreditation request for organization \'test2\' has been activated and is now officially recognized.', 'accreditation', 'unread', 13, '2026-03-18 03:35:07'),
(242, 7, 4, 'Accreditation Activated', 'Accreditation for \'test2\' is now Active.', 'accreditation', 'unread', 13, '2026-03-18 03:35:07'),
(243, 39, 4, 'Accreditation Activated', 'Accreditation for \'test2\' is now Active.', 'accreditation', 'unread', 13, '2026-03-18 03:35:07'),
(244, 24, 31, 'Accomplishment Report Submitted', 'Accomplishment report for event \'test\' has been submitted for review by lorem ipsum.', 'accomplishment', 'unread', 16, '2026-03-18 03:48:47');

-- --------------------------------------------------------

--
-- Table structure for table `organizations`
--

CREATE TABLE `organizations` (
  `id` int(10) UNSIGNED NOT NULL,
  `org_type` enum('Organization','Club') NOT NULL DEFAULT 'Organization',
  `org_name` varchar(255) NOT NULL,
  `abbreviation` varchar(50) NOT NULL,
  `logo_path` varchar(255) DEFAULT NULL,
  `description` text DEFAULT NULL,
  `mission` text NOT NULL,
  `vision` text NOT NULL,
  `objectives` text NOT NULL,
  `advocacy` text NOT NULL,
  `scope` enum('General','Exclusive') NOT NULL DEFAULT 'General',
  `program_id` int(11) DEFAULT NULL,
  `membership_fee` decimal(10,2) NOT NULL DEFAULT 0.00,
  `fee_required` decimal(10,2) NOT NULL DEFAULT 0.00,
  `status` enum('Active','Inactive','Archived') NOT NULL DEFAULT 'Active',
  `created_by` int(10) UNSIGNED DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `organizations`
--

INSERT INTO `organizations` (`id`, `org_type`, `org_name`, `abbreviation`, `logo_path`, `description`, `mission`, `vision`, `objectives`, `advocacy`, `scope`, `program_id`, `membership_fee`, `fee_required`, `status`, `created_by`, `created_at`) VALUES
(1, 'Organization', 'Society of Computer Enthusiast', 'SOCE', 'assets/uploads/org-logos/org_20260304_040308_a7fcadfb.jpg', 'Society of Computer Enthusiast', 'Our Mission is Lorem ipsum I miss you so much', 'Our Vision is Lorem ipsum', 'Our Objectives are Lorem ipsum', 'We advocate Lorem ipsum', 'Exclusive', 1, 0.00, 100.00, 'Active', 24, '2026-02-06 05:38:35'),
(2, 'Club', 'Ball Club', 'BC', NULL, 'ballin', 'we ballin', 'we rollin', 'we dribblin', 'Dear Basketball,\r\n\r\nFrom the moment\r\nI started rolling my dad’s tube socks\r\nAnd shooting imaginary\r\nGame-winning shots\r\nIn the Great Western Forum\r\nI knew one thing was real:\r\n\r\nI fell in love with you.\r\n\r\nA love so deep I gave you my all —\r\nFrom my mind & body\r\nTo my spirit & soul.\r\n\r\nAs a six-year-old boy\r\nDeeply in love with you\r\nI never saw the end of the tunnel.\r\nI only saw myself\r\nRunning out of one.\r\n\r\nAnd so I ran.\r\nI ran up and down every court\r\nAfter every loose ball for you.\r\nYou asked for my hustle\r\nI gave you my heart\r\nBecause it came with so much more.\r\n\r\nI played through the sweat and hurt\r\nNot because challenge called me\r\nBut because YOU called me.\r\nI did everything for YOU\r\nBecause that’s what you do\r\nWhen someone makes you feel as\r\nAlive as you’ve made me feel.\r\n\r\nYou gave a six-year-old boy his Laker dream\r\nAnd I’ll always love you for it.\r\nBut I can’t love you obsessively for much longer.\r\nThis season is all I have left to give.\r\nMy heart can take the pounding\r\nMy mind can handle the grind\r\nBut my body knows it’s time to say goodbye.\r\n\r\nAnd that’s OK.\r\nI’m ready to let you go.\r\nI want you to know now\r\nSo we both can savor every moment we have left together.\r\nThe good and the bad.\r\nWe have given each other\r\nAll that we have.\r\n\r\nAnd we both know, no matter what I do next\r\nI’ll always be that kid\r\nWith the rolled up socks\r\nGarbage can in the corner\r\n:05 seconds on the clock\r\nBall in my hands.\r\n5 … 4 … 3 … 2 … 1\r\n\r\nLove you always,\r\nKobe', 'General', NULL, 50.00, 0.00, 'Active', 7, '2026-02-10 01:52:46'),
(3, 'Organization', 'The Cache', 'TC', NULL, NULL, 'lorem ipsum', 'lorem ipsum dems', 'bruhms', 'dums', 'General', NULL, 0.00, 100.00, 'Active', 36, '2026-02-14 11:38:49'),
(4, 'Club', 'Rotaract', 'Rotaract', NULL, 'rotaract', 'Rotaract', 'Rotaract', 'Rotaract', 'Rotaract', 'General', NULL, 50.00, 0.00, 'Active', 37, '2026-03-06 07:04:56'),
(7, 'Organization', 'tester', 'test', NULL, 'asdasd', 'asdasd', 'asdasd', 'asdasd', 'asdasd', 'General', NULL, 0.00, 100.00, 'Active', 41, '2026-03-09 07:25:52'),
(8, 'Organization', 'test2', 'test2', NULL, 'test', 'test', 'test', 'test', 'test', 'General', NULL, 0.00, 50.00, 'Active', 7, '2026-03-15 07:31:09');

-- --------------------------------------------------------

--
-- Table structure for table `organization_fee_payments`
--

CREATE TABLE `organization_fee_payments` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `org_id` int(10) UNSIGNED NOT NULL,
  `student_user_id` int(10) UNSIGNED NOT NULL,
  `academic_term_id` int(10) UNSIGNED NOT NULL,
  `amount` decimal(10,2) NOT NULL DEFAULT 0.00,
  `paid_at` datetime NOT NULL,
  `receipt_no` varchar(60) NOT NULL,
  `paid_by_user_id` int(10) UNSIGNED NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `organization_fee_payments`
--

INSERT INTO `organization_fee_payments` (`id`, `org_id`, `student_user_id`, `academic_term_id`, `amount`, `paid_at`, `receipt_no`, `paid_by_user_id`, `created_at`) VALUES
(1, 1, 26, 2, 100.00, '2026-02-11 08:00:00', 'ORG1-T2-20260211-6302CF4A', 31, '2026-02-11 11:52:32'),
(2, 1, 19, 2, 100.00, '2026-02-11 08:00:00', 'ORG1-T2-20260211-53AD4DD8', 31, '2026-02-11 14:12:45'),
(3, 1, 7, 2, 100.00, '2026-02-14 08:00:00', 'ORG1-T2-20260214-9750EFBF', 31, '2026-02-14 18:12:41'),
(4, 1, 31, 4, 100.00, '2026-02-28 09:03:00', 'ORG1-T4-20260228-856BED86', 31, '2026-02-28 09:03:44'),
(5, 1, 34, 4, 100.00, '2026-03-04 08:03:00', 'ORG1-T4-20260304-3DFFF101', 31, '2026-03-04 08:03:37'),
(6, 1, 32, 4, 100.00, '2026-03-04 09:37:00', '1234567890', 31, '2026-03-04 09:38:24');

-- --------------------------------------------------------

--
-- Table structure for table `organization_fee_receipts`
--

CREATE TABLE `organization_fee_receipts` (
  `id` int(10) UNSIGNED NOT NULL,
  `payment_id` bigint(20) UNSIGNED NOT NULL,
  `receipt_no` varchar(60) NOT NULL,
  `amount` decimal(10,2) NOT NULL DEFAULT 0.00,
  `paid_at` datetime NOT NULL,
  `paid_by_user_id` int(10) UNSIGNED NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `organization_fee_receipts`
--

INSERT INTO `organization_fee_receipts` (`id`, `payment_id`, `receipt_no`, `amount`, `paid_at`, `paid_by_user_id`, `created_at`) VALUES
(1, 1, 'ORG1-T2-20260211-6302CF4A', 100.00, '2026-02-11 08:00:00', 31, '2026-02-11 13:24:38'),
(2, 2, 'ORG1-T2-20260211-53AD4DD8', 100.00, '2026-02-11 08:00:00', 31, '2026-02-11 14:12:45'),
(3, 3, 'ORG1-T2-20260214-9750EFBF', 100.00, '2026-02-14 08:00:00', 31, '2026-02-14 18:12:41'),
(4, 4, 'ORG1-T4-20260228-856BED86', 100.00, '2026-02-28 09:03:00', 31, '2026-02-28 09:03:45'),
(5, 5, 'ORG1-T4-20260304-3DFFF101', 100.00, '2026-03-04 08:03:00', 31, '2026-03-04 08:03:37'),
(6, 6, '1234567890', 100.00, '2026-03-04 09:37:00', 31, '2026-03-04 09:38:24');

-- --------------------------------------------------------

--
-- Table structure for table `organization_memberships`
--

CREATE TABLE `organization_memberships` (
  `id` int(10) UNSIGNED NOT NULL,
  `org_id` int(10) UNSIGNED NOT NULL,
  `student_user_id` int(10) UNSIGNED NOT NULL,
  `academic_term_id` int(10) UNSIGNED NOT NULL,
  `status` enum('Pending','Approved','Rejected','Archived') NOT NULL DEFAULT 'Pending',
  `fee_amount` decimal(10,2) NOT NULL DEFAULT 0.00,
  `fee_paid` tinyint(1) NOT NULL DEFAULT 0,
  `fee_paid_at` datetime DEFAULT NULL,
  `requested_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `reviewed_by` int(10) UNSIGNED DEFAULT NULL,
  `reviewed_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `organization_memberships`
--

INSERT INTO `organization_memberships` (`id`, `org_id`, `student_user_id`, `academic_term_id`, `status`, `fee_amount`, `fee_paid`, `fee_paid_at`, `requested_at`, `reviewed_by`, `reviewed_at`) VALUES
(2, 2, 30, 2, 'Approved', 50.00, 1, '2026-02-10 00:00:00', '2026-02-10 04:43:57', 7, '2026-02-10 05:44:45'),
(3, 2, 7, 2, 'Approved', 50.00, 1, '2026-02-10 00:00:00', '2026-02-10 07:37:10', 7, '2026-02-10 15:37:10'),
(4, 2, 27, 2, 'Approved', 50.00, 1, '2026-02-10 00:00:00', '2026-02-10 08:08:55', 7, '2026-02-10 16:08:55'),
(5, 2, 26, 2, 'Approved', 50.00, 1, '2026-02-10 00:00:00', '2026-02-10 08:16:05', 7, '2026-02-10 16:16:05'),
(6, 2, 31, 2, 'Approved', 50.00, 1, '2026-02-14 00:00:00', '2026-02-14 07:20:42', 7, '2026-02-14 15:21:23'),
(7, 2, 22, 2, 'Approved', 50.00, 1, '2026-03-04 00:00:00', '2026-03-03 21:55:20', 7, '2026-03-04 06:06:20'),
(8, 2, 34, 2, 'Approved', 50.00, 1, '2026-03-04 00:00:00', '2026-03-04 01:41:21', 7, '2026-03-04 09:44:02');

-- --------------------------------------------------------

--
-- Table structure for table `organization_membership_receipts`
--

CREATE TABLE `organization_membership_receipts` (
  `id` int(10) UNSIGNED NOT NULL,
  `membership_id` int(10) UNSIGNED NOT NULL,
  `receipt_no` varchar(50) NOT NULL,
  `amount` decimal(10,2) NOT NULL,
  `paid_at` datetime NOT NULL,
  `paid_by_user_id` int(10) UNSIGNED NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `organization_membership_receipts`
--

INSERT INTO `organization_membership_receipts` (`id`, `membership_id`, `receipt_no`, `amount`, `paid_at`, `paid_by_user_id`, `created_at`) VALUES
(1, 2, 'CLUB2-T2-20260210-74A7B66E', 50.00, '2026-02-10 00:00:00', 7, '2026-02-10 05:44:45'),
(2, 3, 'CLUB2-T2-20260210-C2BBF6A8', 50.00, '2026-02-10 00:00:00', 7, '2026-02-10 15:37:10'),
(3, 4, 'CLUB2-T2-20260210-89C4D3FC', 50.00, '2026-02-10 00:00:00', 7, '2026-02-10 16:08:55'),
(4, 5, 'CLUB2-T2-20260210-2D455167', 50.00, '2026-02-10 00:00:00', 7, '2026-02-10 16:16:05'),
(5, 6, 'CLUB2-T2-20260214-7D444DC8', 50.00, '2026-02-14 00:00:00', 7, '2026-02-14 15:21:23'),
(6, 7, 'CLUB2-T2-20260303-D94D77CF', 50.00, '2026-03-04 00:00:00', 7, '2026-03-04 06:06:20'),
(7, 8, '123456677888', 50.00, '2026-03-04 00:00:00', 7, '2026-03-04 09:44:02');

-- --------------------------------------------------------

--
-- Table structure for table `organization_officers`
--

CREATE TABLE `organization_officers` (
  `id` int(10) UNSIGNED NOT NULL,
  `org_id` int(10) UNSIGNED NOT NULL,
  `academic_term_id` int(10) UNSIGNED NOT NULL,
  `user_id` int(10) UNSIGNED DEFAULT NULL,
  `position` varchar(80) NOT NULL,
  `full_name` varchar(255) DEFAULT NULL,
  `course_year` varchar(100) DEFAULT NULL,
  `status` enum('Active','Inactive') NOT NULL DEFAULT 'Active',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `organization_officers`
--

INSERT INTO `organization_officers` (`id`, `org_id`, `academic_term_id`, `user_id`, `position`, `full_name`, `course_year`, `status`, `created_at`) VALUES
(1, 1, 1, 7, 'President / Chairperson', 'Karl Isiah Bagaipo Poloyapoy', 'BSIT 4th Year', 'Active', '2026-02-06 23:16:32'),
(2, 1, 1, 26, 'Vice President', 'Rhadz Joseph R. Ganzan', 'BSIT 4th Year', 'Active', '2026-02-06 23:16:32'),
(3, 1, 1, 27, 'Secretary', 'Edkarmel G. Piscos', 'BSIT 4th Year', 'Active', '2026-02-06 23:16:32'),
(4, 1, 1, 9, 'Treasurer', 'testing test test', 'BSIT 1st Year', 'Active', '2026-02-06 23:16:32'),
(5, 1, 1, 8, 'Auditor', 'testing as tester', 'BSIT 1st Year', 'Active', '2026-02-06 23:16:32'),
(34, 2, 2, 7, 'President / Chairperson', 'Karl Isiah Bagaipo Poloyapoy', 'BSIT 4th Year', 'Active', '2026-02-07 07:20:41'),
(35, 2, 2, 26, 'Vice President', 'Rhadz Joseph R. Ganzan', 'BSIT 4th Year', 'Active', '2026-02-07 07:20:41'),
(36, 2, 2, 27, 'Secretary', 'Edkarmel G. Piscos', 'BSIT 4th Year', 'Active', '2026-02-07 07:20:41'),
(37, 2, 2, 9, 'Treasurer', 'testing test test', 'BSIT 1st Year', 'Active', '2026-02-07 07:20:41'),
(38, 2, 2, 8, 'Auditor', 'testing as tester', 'BSIT 1st Year', 'Active', '2026-02-07 07:20:41'),
(39, 1, 2, 31, 'President / Chairperson', 'lorem ipsum', 'BSIT 1st Year', 'Active', '2026-02-11 03:37:34'),
(40, 1, 2, 32, 'Vice President', 'lorem ipsum2', 'BSIT 1st Year', 'Active', '2026-02-11 03:37:34'),
(41, 1, 2, 33, 'Secretary', 'lorem ipsum3', 'BSIT 1st Year', 'Active', '2026-02-11 03:37:34'),
(42, 1, 2, 34, 'Treasurer', 'lorem ipsum4', 'BSIT 1st Year', 'Active', '2026-02-11 03:37:34'),
(43, 1, 2, 35, 'Auditor', 'lorem ipsum5', 'BSIT 1st Year', 'Active', '2026-02-11 03:37:34'),
(58, 7, 4, 43, 'President / Chairperson', 'bad b b', 'BSIT 1st Year', 'Active', '2026-03-09 07:25:52'),
(59, 7, 4, 42, 'Vice President', 'asdasd asdasd asdasd', 'BSIT 1st Year', 'Active', '2026-03-09 07:25:52'),
(60, 7, 4, 46, 'Secretary', 'def d d', 'BSIT 1st Year', 'Active', '2026-03-09 07:25:52'),
(61, 7, 4, 45, 'Treasurer', 'defs d d', 'BSIT 1st Year', 'Active', '2026-03-09 07:25:52'),
(62, 7, 4, 30, 'Auditor', 'placeholder student', 'BSIT Irregular', 'Active', '2026-03-09 07:25:52'),
(63, 8, 4, 7, 'President / Chairperson', 'Karl Isiah Poloyapoy', 'BSIT 4th Year', 'Active', '2026-03-15 07:31:09'),
(64, 8, 4, 27, 'Vice President', 'Edkarmel G. Piscos', 'BSIT 4th Year', 'Active', '2026-03-15 07:31:09'),
(65, 8, 4, 26, 'Secretary', 'Rhadz Joseph R. Ganzan', 'BSIT 4th Year', 'Active', '2026-03-15 07:31:09'),
(66, 8, 4, 31, 'Treasurer', 'lorem ipsum', 'BSIT 1st Year', 'Active', '2026-03-15 07:31:09'),
(67, 8, 4, 38, 'Auditor', 'Balls Balls', 'BSIT 2nd Year', 'Active', '2026-03-15 07:31:09'),
(68, 8, 4, 33, 'PIO', 'lorem ipsum3', 'BSIT 1st Year', 'Active', '2026-03-15 07:31:09');

-- --------------------------------------------------------

--
-- Table structure for table `passbook_logs`
--

CREATE TABLE `passbook_logs` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `org_id` int(10) UNSIGNED NOT NULL,
  `event_id` int(10) UNSIGNED DEFAULT NULL,
  `txn_date` date NOT NULL,
  `txn_type` enum('credit','debit') NOT NULL,
  `title` varchar(160) NOT NULL,
  `notes` varchar(255) DEFAULT NULL,
  `amount_in` decimal(10,2) NOT NULL DEFAULT 0.00,
  `amount_out` decimal(10,2) NOT NULL DEFAULT 0.00,
  `balance_after` decimal(12,2) NOT NULL DEFAULT 0.00,
  `ref_table` varchar(64) NOT NULL,
  `ref_id` bigint(20) UNSIGNED NOT NULL,
  `recorded_by_user_id` int(10) UNSIGNED NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `programs`
--

CREATE TABLE `programs` (
  `id` int(11) NOT NULL,
  `program_name` varchar(255) NOT NULL,
  `abbreviation` varchar(50) NOT NULL,
  `image_path` varchar(255) DEFAULT NULL,
  `status` enum('Active','Inactive','Archived') NOT NULL DEFAULT 'Active',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `programs`
--

INSERT INTO `programs` (`id`, `program_name`, `abbreviation`, `image_path`, `status`, `created_at`) VALUES
(1, 'Bachelor of Science and Information Technology', 'BSIT', 'uploads/programs/program_20260119_000912_66ead7210890.jpg', 'Active', '2026-01-18 15:03:57');

-- --------------------------------------------------------

--
-- Table structure for table `users`
--

CREATE TABLE `users` (
  `id` int(10) UNSIGNED NOT NULL,
  `id_number` varchar(50) NOT NULL,
  `first_name` varchar(100) NOT NULL,
  `middle_name` varchar(100) DEFAULT NULL,
  `last_name` varchar(100) NOT NULL,
  `suffix` varchar(20) DEFAULT NULL,
  `email` varchar(255) DEFAULT NULL,
  `program` varchar(50) DEFAULT NULL,
  `year_level` varchar(20) DEFAULT NULL,
  `school_year` varchar(20) DEFAULT NULL,
  `password_hash` varchar(255) NOT NULL,
  `role` enum('overseer','super_admin','special_admin','faculty_admin','moderator','org_president','treasurer','org_officer','student') NOT NULL DEFAULT 'student',
  `status` enum('Active','Inactive','Pending','Archived') NOT NULL DEFAULT 'Active',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `last_login_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `users`
--

INSERT INTO `users` (`id`, `id_number`, `first_name`, `middle_name`, `last_name`, `suffix`, `email`, `program`, `year_level`, `school_year`, `password_hash`, `role`, `status`, `created_at`, `last_login_at`) VALUES
(1, '08132004', 'Overseer', NULL, 'Council', NULL, NULL, NULL, NULL, NULL, '$2y$10$ANYKm5EC4yax9RpEg/O/w.6s47LonBgX1StGlY1xLkADeTTxaC1fe', 'overseer', 'Active', '2026-01-14 20:51:45', '2026-03-15 17:28:50'),
(2, '0000', 'Karl Isiah', 'B.', 'Poloyapoy', NULL, NULL, NULL, NULL, NULL, '$2y$10$ByWAM4pvRkEhZezqAcCKROvVG7c0WE2YGMZZwGg6c9P4xf3A8DJhS', 'super_admin', 'Inactive', '2026-01-14 21:02:40', NULL),
(3, '2025303899', 'Special', NULL, 'Admin', NULL, 'special.admin@example.com', NULL, NULL, '2025-2026', '$2y$10$ZdhSrrvn0IZpC2KYhd1w5ejtyeCNn/16xTAG5EgB5oO//5WXU5fD2', 'special_admin', 'Inactive', '2026-01-14 21:02:51', '2026-03-04 16:36:34'),
(4, '11111', 'Super', NULL, 'Admin', NULL, NULL, NULL, NULL, NULL, '$2y$10$5lulslarNJc6jX3ANagwHuJnJFMXZnieADuL1QRrHMnYMPlSEruXy', 'super_admin', 'Active', '2026-01-17 13:59:23', '2026-03-18 11:34:59'),
(5, '2222', 'Tester', NULL, 'Tester', NULL, NULL, NULL, NULL, NULL, '$2y$10$LxP4FATT4ltW.dCzlT61N.hXpeFL7miPijeSbdzB/3dwXhx8eYoxe', 'super_admin', 'Inactive', '2026-01-17 15:30:41', NULL),
(6, '1231233', 'this', 'is', 'just a test', NULL, NULL, NULL, NULL, NULL, '$2y$10$GT/xohCTfI3m8rrejTioG.y6CVkUoQ1rioSzf/HfNAx/UYy3JY1b2', 'special_admin', 'Inactive', '2026-01-18 08:06:45', NULL),
(7, '2022303890', 'Karl Isiah', 'Bagaipo', 'Poloyapoy', '', 'poloyapoykarlisiah17@gmail.com', 'BSIT', '4th Year', '2025-2026', '$2y$10$w0WZfTHGmeG8iUnT1EBRlezr8P6/ToAI.dI.E12PqVPqVAK3lE1Ri', 'org_president', 'Active', '2026-01-20 19:04:36', '2026-03-18 11:47:49'),
(8, '2022303891', 'testing', 'as', 'tester', NULL, NULL, 'BSIT', '1st Year', '2025-2026', '$2y$10$ob1yPcLLUNiHBd/w7NMyM.aWKf05NBsdGjURtkdbqQiZa9LGeP5ou', 'student', 'Active', '2026-01-20 19:07:24', NULL),
(9, '1234567890', 'testing', 'test', 'test', NULL, NULL, 'BSIT', '1st Year', '2025-2026', '$2y$10$CPirpmiZ.BTDuGQd1fmQTuHKYygBiEgSBrfLXMCecdqc2ffU507au', 'student', 'Active', '2026-01-21 07:32:27', NULL),
(10, '2022303892', 'testing', 'test', 'test', NULL, 'example@gmail.com', 'BSIT', '1st Year', '2025-2026', '$2y$10$7cuTRyuFQwUuyRt4e7xme.2qQ3tTLbvYknzHJEA75nC04Gr1cxX4a', 'student', 'Active', '2026-01-23 19:00:00', NULL),
(19, '2022303894', 'testier', 'test', 'test', NULL, NULL, 'BSIT', '1st Year', '2025-2026', '$2y$10$xjqeEbzuBlGM2VNd1pm8Z.g16uqC3ppMdia0lI2j.Bg4qKvikMO7O', 'student', 'Active', '2026-01-23 19:30:08', NULL),
(22, '2022303895', 'final test', 'test', 'test', NULL, NULL, 'BSIT', '1st Year', '2025-2026', '$2y$10$psFxPhy28olE2B4x9jsCr.GggZ8Q/XgCrJF2DsTsOF70B7XL.r3/a', 'student', 'Active', '2026-01-23 21:06:41', '2026-03-15 21:51:44'),
(23, '2022303896', 'test', NULL, 'test', NULL, NULL, 'BSIT', '1st Year', '2025-2026', '$2y$10$rpOuXMmlWkHPxnrY7j4FpuiRXrm4hjkRQrDtjybf1XZS12hw8.DDi', 'student', 'Active', '2026-01-24 07:49:53', NULL),
(24, '2022313890', 'tester', 'test', 'tester', NULL, 'testing@gmail.com', 'BSIT', NULL, NULL, '$2y$10$uLxSSeRHx0xnoRJw9n0Skebu6CLtIDJDGbNGhozcTRFs1qWrPoiKq', 'faculty_admin', 'Active', '2026-01-24 11:49:14', '2026-03-18 11:49:03'),
(25, '2024123456', 'testing', NULL, 'tester', NULL, NULL, NULL, NULL, NULL, '$2y$10$g9zEyD9FO8re61XQILgwsuXzLQDMWzqKeZESD5HHChLqv/4R66aMG', 'moderator', 'Active', '2026-01-24 13:11:31', NULL),
(26, '2022303202', 'Rhadz Joseph', 'R.', 'Ganzan', NULL, NULL, 'BSIT', '4th Year', '2025-2026', '$2y$10$3Q/.A/4Ooxyc2IgPN52QXu4QnRNU6wFClsLAXdWYgmQTzmB42kODm', 'student', 'Active', '2026-02-06 13:35:24', '2026-03-04 16:34:58'),
(27, '2022303123', 'Edkarmel', 'G.', 'Piscos', NULL, NULL, 'BSIT', '4th Year', '2025-2026', '$2y$10$PllYQ2WyBxoRkhJU1rjPOOF.RymI1I1.AaOIPBz8t91g.nGJ3mIfO', 'student', 'Active', '2026-02-06 13:36:03', NULL),
(28, '2004', 'buns', NULL, 'buns', NULL, NULL, NULL, NULL, NULL, '$2y$10$q.JeoGpF6/XP/r9Jf5Jfwu0ZoLCwKcb1pN.4xX3XaYLEwxjvl1iT.', 'faculty_admin', 'Active', '2026-02-10 09:49:13', '2026-02-10 19:13:17'),
(29, '2005', 'mods', NULL, 'mods', NULL, NULL, NULL, NULL, NULL, '$2y$10$v8PjKSe6SpKksdOO2eOveOHW3ef7PgJSxnLGSwnW0ZsLKZGk7l1l.', 'moderator', 'Active', '2026-02-10 09:49:45', '2026-02-10 16:44:03'),
(30, '2022123456', 'placeholder', NULL, 'student', NULL, NULL, 'BSIT', 'Irregular', '2026-2027', '$2y$10$Y/Uzjeut/E9zb4r1wpTuBe3a2xnajhfLpdLACAZPdHzRPP85407zy', 'student', 'Active', '2026-02-10 12:42:52', '2026-03-13 10:17:51'),
(31, '1234', 'lorem', NULL, 'ipsum', NULL, NULL, 'BSIT', '1st Year', '2026-2027', '$2y$10$CM8tLK4kxSkyV5iJzR9E/OTbKGE6Lymevr.hinesoUAYRDovnmR6i', 'student', 'Active', '2026-02-11 11:28:02', '2026-03-21 11:16:20'),
(32, '123', 'lorem', NULL, 'ipsum2', NULL, NULL, 'BSIT', '1st Year', '2026-2027', '$2y$10$E5P7APdlKWKNfNSH1DpzrOyn95HZ5RUFQhqNn1sA9unL6LYzCiYcW', 'student', 'Active', '2026-02-11 11:28:38', '2026-03-15 16:17:47'),
(33, '12345', 'lorem', NULL, 'ipsum3', NULL, NULL, 'BSIT', '1st Year', '2026-2027', '$2y$10$Lx7o6G3WXZ515eD9tnpnJ.1dibraMU707qDQ6IKCzM3ezhUFKQ3IG', 'student', 'Active', '2026-02-11 11:29:24', NULL),
(34, '123456', 'lorem', NULL, 'ipsum4', NULL, NULL, 'BSIT', '1st Year', '2026-2027', '$2y$10$Ji7zY1W7f0q2JTQlzRM8RuI3RhtnwHlgdm2txoKK.F103FT.6fFCy', 'student', 'Active', '2026-02-11 11:29:43', '2026-03-04 09:41:08'),
(35, '1234567', 'lorem', NULL, 'ipsum5', NULL, NULL, 'BSIT', '1st Year', '2026-2027', '$2y$10$Gz1abyvU8.LHQcM3xszfouDVSBsYU63isbGF8X7cFZBxsdWTp99.6', 'student', 'Active', '2026-02-11 11:34:16', '2026-02-14 15:22:41'),
(36, '3212', 'testing', NULL, 'test', NULL, NULL, NULL, NULL, NULL, '$2y$10$Wj8OFoD6NcEQcDVRyradWe1WfHC7vTp2q.vEFh0DN8wMfiTNnA0Xi', 'faculty_admin', 'Active', '2026-02-14 19:35:19', '2026-02-14 19:36:31'),
(37, '67', 'admin', NULL, 'admin', NULL, NULL, NULL, NULL, NULL, '$2y$10$mnUlLfWevNKcSS7rpHjmcunL/2a2TeqbVOUgVRdR4Pzb2JALQP/wK', 'faculty_admin', 'Archived', '2026-03-04 12:37:41', '2026-03-09 09:34:54'),
(38, '69', 'Balls', NULL, 'Balls', NULL, 'sigmaballs@gmail.com', 'BSIT', '2nd Year', '2026-2027', '$2y$10$J0mGrA0TskefFVz6av8hYeZ3foCdqbXZBb6tle6APx.wtPSZFvmcK', 'student', 'Active', '2026-03-04 13:41:31', '2026-03-09 09:35:29'),
(39, '2026', 'Glenda', NULL, 'Colalo', NULL, NULL, NULL, NULL, NULL, '$2y$10$hxZMMHklWrMNIc62EERz.uYUQQGYUbZvcdDCtiL2JoETvhFtnpJKu', 'special_admin', 'Active', '2026-03-04 16:37:41', '2026-03-18 11:34:29'),
(40, '3172744', 'John', NULL, 'Doe', NULL, NULL, NULL, NULL, NULL, '$2y$10$KN6BHjr2Pjg7Z57k/hfirep9fUxgwcgqBWAizcPD5dfumed5FQgty', 'faculty_admin', 'Archived', '2026-03-06 15:12:58', '2026-03-07 17:42:18'),
(41, '1', 'tester1', 'tester', 'tester2', NULL, NULL, NULL, NULL, NULL, '$2y$10$PwESJ3X3iCUG1IIrhaCByOZTFyGXR1y2z4g1gVuM.hjVQA4wEiZom', 'faculty_admin', 'Active', '2026-03-09 14:56:44', '2026-03-15 20:08:33'),
(42, '2', 'asdasd', 'asdasd', 'asdasd', NULL, NULL, 'BSIT', '1st Year', '2026-2027', '$2y$10$eXPGGVVptSEoo4QxsGFvvOKaAQycAb3L8/3t1hFbTTrrlOljJKDky', 'student', 'Active', '2026-03-09 14:57:50', NULL),
(43, '3', 'bad', 'b', 'b', NULL, NULL, 'BSIT', '1st Year', '2026-2027', '$2y$10$vYeiKomMrah.1g9iiwNgKuPW96D492YxmdJ4JI1yw.s8Oax586r8.', 'student', 'Active', '2026-03-09 14:58:13', NULL),
(44, '4', 'cad', 'c', 'c', NULL, NULL, 'BSIT', '1st Year', '2026-2027', '$2y$10$fl8ByDfR0Vv82ntlTmKKUerkOckmgl9vIBQA5w13IuSYpFjaYKPWK', 'student', 'Active', '2026-03-09 14:58:30', NULL),
(45, '5', 'defs', 'd', 'd', NULL, NULL, 'BSIT', '1st Year', '2026-2027', '$2y$10$R/BbX.Smk2K3YRWxQ42y7edIvZ2L9kF3Ic5OfSBwpUTLkv7NNvq/q', 'student', 'Active', '2026-03-09 14:58:55', NULL),
(46, '6', 'def', 'd', 'd', NULL, NULL, 'BSIT', '1st Year', '2026-2027', '$2y$10$DDfZGhl6SLsetU8GDX4i4.EE9OSJI8dUaylo7lmTL3PmPGRYby3/G', 'student', 'Active', '2026-03-09 14:59:19', NULL),
(47, '7', 'efg', 'e', 'e', NULL, NULL, 'BSIT', '1st Year', '2026-2027', '$2y$10$fsx7UEIjaPvmCBaobWOrCOk3RY5X2ANF7JS16ZcvOQh9zUqRFOdpS', 'student', 'Active', '2026-03-09 14:59:37', NULL),
(48, '9', 'placeholder', NULL, 'placeholder', NULL, NULL, 'BSIT', '1st Year', '2026-2027', '$2y$10$XBpbJF.9rVNH/S1vKl81oOkOglPp97hFoMrM7k3Ff4dGbeMYvoAjq', 'student', 'Active', '2026-03-13 10:19:53', '2026-03-15 20:12:15'),
(49, '66', 'test', 'er', 'test', NULL, NULL, 'BSIT', '1st Year', '2026-2027', '$2y$10$G2zg8q6suvf7qJ35RhY5J.nKc.wQCNA2zHrE9BTD4d.UBhifnl07O', 'student', 'Pending', '2026-03-15 18:15:40', NULL),
(50, '65', 'test', 'testtt', 'test', NULL, NULL, 'BSIT', '1st Year', '2026-2027', '$2y$10$xzuJY5v6Ir2IzIAXWS3JiOGJ2YghQhuusmM8eU7/pOf28arKOHIAG', 'org_president', 'Active', '2026-03-15 18:17:30', NULL);

--
-- Indexes for dumped tables
--

--
-- Indexes for table `academic_terms`
--
ALTER TABLE `academic_terms`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_school_year_semester` (`school_year`,`semester`);

--
-- Indexes for table `accreditation_requests`
--
ALTER TABLE `accreditation_requests`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_req_one_per_org_term` (`org_id`,`academic_term_id`),
  ADD KEY `idx_req_status` (`status`),
  ADD KEY `idx_req_coord` (`coordinator_user_id`),
  ADD KEY `fk_req_term` (`academic_term_id`),
  ADD KEY `idx_req_moderator` (`moderator_user_id`),
  ADD KEY `idx_renewal_previous` (`previous_request_id`);

--
-- Indexes for table `accreditation_request_documents`
--
ALTER TABLE `accreditation_request_documents`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_one_upload_per_req` (`request_id`,`requirement_id`),
  ADD KEY `fk_doc_requirement` (`requirement_id`),
  ADD KEY `fk_doc_reviewed_by` (`reviewed_by`),
  ADD KEY `idx_copied_from` (`copied_from_doc_id`);

--
-- Indexes for table `accreditation_requirements`
--
ALTER TABLE `accreditation_requirements`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_req_name` (`requirement_name`),
  ADD KEY `fk_req_created_by` (`created_by`);

--
-- Indexes for table `accreditation_requirement_templates`
--
ALTER TABLE `accreditation_requirement_templates`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_tpl_req` (`requirement_id`),
  ADD KEY `idx_tpl_active` (`requirement_id`,`is_active`),
  ADD KEY `fk_tpl_uploaded_by` (`uploaded_by`);

--
-- Indexes for table `admin_role_history`
--
ALTER TABLE `admin_role_history`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_role_active` (`role`,`revoked_at`),
  ADD KEY `idx_user_role` (`user_id`,`role`);

--
-- Indexes for table `announcements`
--
ALTER TABLE `announcements`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_term_status` (`academic_term_id`,`status`),
  ADD KEY `idx_org_term` (`org_id`,`academic_term_id`),
  ADD KEY `idx_target_user` (`target_user_id`),
  ADD KEY `fk_ann_created_by` (`created_by`),
  ADD KEY `fk_ann_reviewed_by` (`reviewed_by`),
  ADD KEY `idx_target_program` (`target_program`);

--
-- Indexes for table `event_accomplishments`
--
ALTER TABLE `event_accomplishments`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_event_accomplishment` (`event_id`),
  ADD KEY `idx_finalized_by` (`finalized_by`),
  ADD KEY `idx_status` (`status`),
  ADD KEY `idx_submitted_by` (`submitted_by`),
  ADD KEY `idx_approved_by` (`approved_by`);

--
-- Indexes for table `event_credits`
--
ALTER TABLE `event_credits`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_credit_event_date` (`event_id`,`credit_date`),
  ADD KEY `idx_credit_recorded_by` (`recorded_by_user_id`);

--
-- Indexes for table `event_debits`
--
ALTER TABLE `event_debits`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_debit_event_date` (`event_id`,`debit_date`),
  ADD KEY `idx_debit_recorded_by` (`recorded_by_user_id`);

--
-- Indexes for table `event_events`
--
ALTER TABLE `event_events`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_event_org` (`org_id`),
  ADD KEY `idx_event_author` (`author_user_id`);

--
-- Indexes for table `event_proposed_credits`
--
ALTER TABLE `event_proposed_credits`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_proposed_credit_event` (`event_id`);

--
-- Indexes for table `event_proposed_expenses`
--
ALTER TABLE `event_proposed_expenses`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_proposed_event` (`event_id`);

--
-- Indexes for table `e_signatures`
--
ALTER TABLE `e_signatures`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_e_signatures_user` (`user_id`),
  ADD KEY `idx_e_signatures_status` (`status`);

--
-- Indexes for table `notifications`
--
ALTER TABLE `notifications`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_notif_recipient` (`recipient_id`),
  ADD KEY `idx_notif_actor` (`actor_id`),
  ADD KEY `idx_notif_status` (`status`),
  ADD KEY `idx_notif_type` (`notif_type`),
  ADD KEY `idx_notif_created` (`created_at`);

--
-- Indexes for table `organizations`
--
ALTER TABLE `organizations`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_org_name` (`org_name`),
  ADD UNIQUE KEY `uq_org_abbr` (`abbreviation`),
  ADD KEY `idx_org_program` (`program_id`),
  ADD KEY `idx_org_scope` (`scope`),
  ADD KEY `idx_org_type` (`org_type`),
  ADD KEY `idx_org_status` (`status`),
  ADD KEY `fk_org_created_by` (`created_by`);

--
-- Indexes for table `organization_fee_payments`
--
ALTER TABLE `organization_fee_payments`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_org_fee_one_per_term` (`org_id`,`student_user_id`,`academic_term_id`),
  ADD UNIQUE KEY `uq_org_fee_receipt_no` (`receipt_no`),
  ADD KEY `idx_org_fee_org_term` (`org_id`,`academic_term_id`),
  ADD KEY `idx_org_fee_student` (`student_user_id`),
  ADD KEY `idx_org_fee_paid_by` (`paid_by_user_id`),
  ADD KEY `fk_org_fee_term` (`academic_term_id`);

--
-- Indexes for table `organization_fee_receipts`
--
ALTER TABLE `organization_fee_receipts`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_org_fee_receipt_no` (`receipt_no`),
  ADD KEY `idx_ofr_payment` (`payment_id`),
  ADD KEY `idx_ofr_paid_by` (`paid_by_user_id`),
  ADD KEY `idx_ofr_paid_at` (`paid_at`);

--
-- Indexes for table `organization_memberships`
--
ALTER TABLE `organization_memberships`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_member_one_per_org_term` (`org_id`,`student_user_id`,`academic_term_id`),
  ADD KEY `idx_member_status` (`status`),
  ADD KEY `idx_member_org` (`org_id`),
  ADD KEY `idx_member_student` (`student_user_id`),
  ADD KEY `fk_mem_term` (`academic_term_id`),
  ADD KEY `fk_mem_reviewed_by` (`reviewed_by`);

--
-- Indexes for table `organization_membership_receipts`
--
ALTER TABLE `organization_membership_receipts`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_receipt_no` (`receipt_no`),
  ADD KEY `idx_receipt_membership` (`membership_id`),
  ADD KEY `idx_receipt_paid_by` (`paid_by_user_id`),
  ADD KEY `idx_receipt_paid_at` (`paid_at`);

--
-- Indexes for table `organization_officers`
--
ALTER TABLE `organization_officers`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_officer_unique_position` (`org_id`,`academic_term_id`,`position`),
  ADD KEY `idx_off_org_term` (`org_id`,`academic_term_id`),
  ADD KEY `idx_off_user` (`user_id`),
  ADD KEY `idx_off_position` (`position`),
  ADD KEY `fk_off_term` (`academic_term_id`);

--
-- Indexes for table `passbook_logs`
--
ALTER TABLE `passbook_logs`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_passbook_org_date` (`org_id`,`txn_date`,`id`),
  ADD KEY `idx_passbook_event` (`event_id`),
  ADD KEY `idx_passbook_ref` (`ref_table`,`ref_id`),
  ADD KEY `fk_passbook_recorded_by_user` (`recorded_by_user_id`);

--
-- Indexes for table `programs`
--
ALTER TABLE `programs`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_program_name` (`program_name`),
  ADD UNIQUE KEY `uq_program_abbr` (`abbreviation`);

--
-- Indexes for table `users`
--
ALTER TABLE `users`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_users_id_number` (`id_number`),
  ADD UNIQUE KEY `uq_users_email` (`email`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `academic_terms`
--
ALTER TABLE `academic_terms`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=5;

--
-- AUTO_INCREMENT for table `accreditation_requests`
--
ALTER TABLE `accreditation_requests`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=14;

--
-- AUTO_INCREMENT for table `accreditation_request_documents`
--
ALTER TABLE `accreditation_request_documents`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=28;

--
-- AUTO_INCREMENT for table `accreditation_requirements`
--
ALTER TABLE `accreditation_requirements`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=6;

--
-- AUTO_INCREMENT for table `accreditation_requirement_templates`
--
ALTER TABLE `accreditation_requirement_templates`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=6;

--
-- AUTO_INCREMENT for table `admin_role_history`
--
ALTER TABLE `admin_role_history`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=11;

--
-- AUTO_INCREMENT for table `announcements`
--
ALTER TABLE `announcements`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=10;

--
-- AUTO_INCREMENT for table `event_accomplishments`
--
ALTER TABLE `event_accomplishments`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=5;

--
-- AUTO_INCREMENT for table `event_credits`
--
ALTER TABLE `event_credits`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=36;

--
-- AUTO_INCREMENT for table `event_debits`
--
ALTER TABLE `event_debits`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=7;

--
-- AUTO_INCREMENT for table `event_events`
--
ALTER TABLE `event_events`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=42;

--
-- AUTO_INCREMENT for table `event_proposed_credits`
--
ALTER TABLE `event_proposed_credits`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=3;

--
-- AUTO_INCREMENT for table `event_proposed_expenses`
--
ALTER TABLE `event_proposed_expenses`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=5;

--
-- AUTO_INCREMENT for table `e_signatures`
--
ALTER TABLE `e_signatures`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=11;

--
-- AUTO_INCREMENT for table `notifications`
--
ALTER TABLE `notifications`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=245;

--
-- AUTO_INCREMENT for table `organizations`
--
ALTER TABLE `organizations`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=9;

--
-- AUTO_INCREMENT for table `organization_fee_payments`
--
ALTER TABLE `organization_fee_payments`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=7;

--
-- AUTO_INCREMENT for table `organization_fee_receipts`
--
ALTER TABLE `organization_fee_receipts`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=7;

--
-- AUTO_INCREMENT for table `organization_memberships`
--
ALTER TABLE `organization_memberships`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=9;

--
-- AUTO_INCREMENT for table `organization_membership_receipts`
--
ALTER TABLE `organization_membership_receipts`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=8;

--
-- AUTO_INCREMENT for table `organization_officers`
--
ALTER TABLE `organization_officers`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=69;

--
-- AUTO_INCREMENT for table `passbook_logs`
--
ALTER TABLE `passbook_logs`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- AUTO_INCREMENT for table `programs`
--
ALTER TABLE `programs`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- AUTO_INCREMENT for table `users`
--
ALTER TABLE `users`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=51;

--
-- Constraints for dumped tables
--

--
-- Constraints for table `accreditation_requests`
--
ALTER TABLE `accreditation_requests`
  ADD CONSTRAINT `fk_previous_request` FOREIGN KEY (`previous_request_id`) REFERENCES `accreditation_requests` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_req_coordinator` FOREIGN KEY (`coordinator_user_id`) REFERENCES `users` (`id`) ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_req_moderator` FOREIGN KEY (`moderator_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_req_org` FOREIGN KEY (`org_id`) REFERENCES `organizations` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_req_term` FOREIGN KEY (`academic_term_id`) REFERENCES `academic_terms` (`id`) ON UPDATE CASCADE;

--
-- Constraints for table `accreditation_request_documents`
--
ALTER TABLE `accreditation_request_documents`
  ADD CONSTRAINT `fk_doc_request` FOREIGN KEY (`request_id`) REFERENCES `accreditation_requests` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_doc_requirement` FOREIGN KEY (`requirement_id`) REFERENCES `accreditation_requirements` (`id`) ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_doc_reviewed_by` FOREIGN KEY (`reviewed_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

--
-- Constraints for table `accreditation_requirements`
--
ALTER TABLE `accreditation_requirements`
  ADD CONSTRAINT `fk_req_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

--
-- Constraints for table `accreditation_requirement_templates`
--
ALTER TABLE `accreditation_requirement_templates`
  ADD CONSTRAINT `fk_tpl_req` FOREIGN KEY (`requirement_id`) REFERENCES `accreditation_requirements` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_tpl_uploaded_by` FOREIGN KEY (`uploaded_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

--
-- Constraints for table `admin_role_history`
--
ALTER TABLE `admin_role_history`
  ADD CONSTRAINT `admin_role_history_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`);

--
-- Constraints for table `announcements`
--
ALTER TABLE `announcements`
  ADD CONSTRAINT `fk_ann_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_ann_org` FOREIGN KEY (`org_id`) REFERENCES `organizations` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_ann_reviewed_by` FOREIGN KEY (`reviewed_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_ann_target_user` FOREIGN KEY (`target_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_ann_term` FOREIGN KEY (`academic_term_id`) REFERENCES `academic_terms` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `event_accomplishments`
--
ALTER TABLE `event_accomplishments`
  ADD CONSTRAINT `fk_accomp_approved_by` FOREIGN KEY (`approved_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_accomp_event` FOREIGN KEY (`event_id`) REFERENCES `event_events` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_accomp_submitted_by` FOREIGN KEY (`submitted_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_accomp_user` FOREIGN KEY (`finalized_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

--
-- Constraints for table `event_credits`
--
ALTER TABLE `event_credits`
  ADD CONSTRAINT `fk_credit_event` FOREIGN KEY (`event_id`) REFERENCES `event_events` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_credit_recorded_by_user` FOREIGN KEY (`recorded_by_user_id`) REFERENCES `users` (`id`) ON UPDATE CASCADE;

--
-- Constraints for table `event_debits`
--
ALTER TABLE `event_debits`
  ADD CONSTRAINT `fk_debit_event` FOREIGN KEY (`event_id`) REFERENCES `event_events` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_debit_recorded_by_user` FOREIGN KEY (`recorded_by_user_id`) REFERENCES `users` (`id`) ON UPDATE CASCADE;

--
-- Constraints for table `event_events`
--
ALTER TABLE `event_events`
  ADD CONSTRAINT `fk_event_author_user` FOREIGN KEY (`author_user_id`) REFERENCES `users` (`id`) ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_event_org` FOREIGN KEY (`org_id`) REFERENCES `organizations` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

--
-- Constraints for table `event_proposed_credits`
--
ALTER TABLE `event_proposed_credits`
  ADD CONSTRAINT `fk_proposed_credit_event` FOREIGN KEY (`event_id`) REFERENCES `event_events` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `event_proposed_expenses`
--
ALTER TABLE `event_proposed_expenses`
  ADD CONSTRAINT `fk_proposed_event` FOREIGN KEY (`event_id`) REFERENCES `event_events` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `e_signatures`
--
ALTER TABLE `e_signatures`
  ADD CONSTRAINT `fk_e_signatures_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `notifications`
--
ALTER TABLE `notifications`
  ADD CONSTRAINT `fk_notif_actor` FOREIGN KEY (`actor_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_notif_recipient` FOREIGN KEY (`recipient_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `organizations`
--
ALTER TABLE `organizations`
  ADD CONSTRAINT `fk_org_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_org_program` FOREIGN KEY (`program_id`) REFERENCES `programs` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

--
-- Constraints for table `organization_fee_payments`
--
ALTER TABLE `organization_fee_payments`
  ADD CONSTRAINT `fk_org_fee_org` FOREIGN KEY (`org_id`) REFERENCES `organizations` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_org_fee_paid_by` FOREIGN KEY (`paid_by_user_id`) REFERENCES `users` (`id`) ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_org_fee_student` FOREIGN KEY (`student_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_org_fee_term` FOREIGN KEY (`academic_term_id`) REFERENCES `academic_terms` (`id`) ON UPDATE CASCADE;

--
-- Constraints for table `organization_fee_receipts`
--
ALTER TABLE `organization_fee_receipts`
  ADD CONSTRAINT `fk_ofr_paid_by` FOREIGN KEY (`paid_by_user_id`) REFERENCES `users` (`id`) ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_ofr_payment` FOREIGN KEY (`payment_id`) REFERENCES `organization_fee_payments` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `organization_memberships`
--
ALTER TABLE `organization_memberships`
  ADD CONSTRAINT `fk_mem_org` FOREIGN KEY (`org_id`) REFERENCES `organizations` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_mem_reviewed_by` FOREIGN KEY (`reviewed_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_mem_student` FOREIGN KEY (`student_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_mem_term` FOREIGN KEY (`academic_term_id`) REFERENCES `academic_terms` (`id`) ON UPDATE CASCADE;

--
-- Constraints for table `organization_membership_receipts`
--
ALTER TABLE `organization_membership_receipts`
  ADD CONSTRAINT `fk_receipt_membership` FOREIGN KEY (`membership_id`) REFERENCES `organization_memberships` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_receipt_paid_by` FOREIGN KEY (`paid_by_user_id`) REFERENCES `users` (`id`) ON UPDATE CASCADE;

--
-- Constraints for table `organization_officers`
--
ALTER TABLE `organization_officers`
  ADD CONSTRAINT `fk_off_org` FOREIGN KEY (`org_id`) REFERENCES `organizations` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_off_term` FOREIGN KEY (`academic_term_id`) REFERENCES `academic_terms` (`id`) ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_off_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

--
-- Constraints for table `passbook_logs`
--
ALTER TABLE `passbook_logs`
  ADD CONSTRAINT `fk_passbook_event` FOREIGN KEY (`event_id`) REFERENCES `event_events` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_passbook_org` FOREIGN KEY (`org_id`) REFERENCES `organizations` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_passbook_recorded_by_user` FOREIGN KEY (`recorded_by_user_id`) REFERENCES `users` (`id`) ON UPDATE CASCADE;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
