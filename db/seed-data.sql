--
-- PostgreSQL database dump
--

\restrict ymO2s4CxkA9GXLJd3ubBDUsTetsAUXGfH8k99oIGccqiByLYbW53BhshlA3WzMq

-- Dumped from database version 16.13 (Homebrew)
-- Dumped by pg_dump version 16.13 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: companies; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.companies (id, name, type, is_active, created_at) VALUES (1, 'TechCorp A.Ş.', 'client', true, '2026-03-14 20:45:30.940665');
INSERT INTO public.companies (id, name, type, is_active, created_at) VALUES (2, 'Staffing Pro Ltd.', 'vendor', true, '2026-03-14 20:45:30.94385');


--
-- Data for Name: job_roles; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.job_roles (id, title, description, skills, salary_min, salary_max, location, employment_type, is_remote, status, company_id, created_at, updated_at) VALUES (1, 'Junior Backend Engineer', 'Local dev smoke test role', 'Node.js, TypeScript, PostgreSQL', 30000.00, 45000.00, 'Istanbul', 'full-time', true, 'draft', 1, '2026-03-14 20:46:09.228798', '2026-03-14 20:46:09.228798');
INSERT INTO public.job_roles (id, title, description, skills, salary_min, salary_max, location, employment_type, is_remote, status, company_id, created_at, updated_at) VALUES (2, 'Junior Backend Engineer', 'Local dev smoke test role', 'Node.js, TypeScript, PostgreSQL', 30000.00, 45000.00, 'Istanbul', 'full-time', true, 'published', 1, '2026-03-14 20:46:37.88251', '2026-03-14 17:46:37.891');
INSERT INTO public.job_roles (id, title, description, skills, salary_min, salary_max, location, employment_type, is_remote, status, company_id, created_at, updated_at) VALUES (3, 'Vercel Smoke Role 1773513065', 'Serverless deployment smoke test role', 'Node.js, TypeScript, Recruitment', 90000.00, 120000.00, 'Istanbul', 'full-time', true, 'published', 1, '2026-03-14 21:31:05.492331', '2026-03-14 18:31:05.512');


--
-- Data for Name: candidates; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.candidates (id, first_name, last_name, email, phone, expected_salary, status, role_id, vendor_company_id, cv_url, tags, submitted_at, updated_at) VALUES (1, 'Eren', 'Sen', 'eren.localtest@example.com', '+90 555 111 22 33', 42000.00, 'submitted', 2, 2, '/objects/uploads/24c974ab-4919-42c2-b0d6-24767c3c47c4', 'Node.js, TypeScript, PostgreSQL', '2026-03-14 20:46:45.263056', '2026-03-14 20:46:45.263056');
INSERT INTO public.candidates (id, first_name, last_name, email, phone, expected_salary, status, role_id, vendor_company_id, cv_url, tags, submitted_at, updated_at) VALUES (2, 'Demo', 'Candidate', 'vercel.smoke.1773513074@example.com', NULL, NULL, 'submitted', 3, 2, '/objects/uploads/df4363bc-af96-428a-89b4-e1d42d8c17c1', NULL, '2026-03-14 21:31:14.593045', '2026-03-14 21:31:14.593045');


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.users (id, email, name, password_hash, role, company_id, is_active, created_at) VALUES (1, 'admin@ats.com', 'Admin Kullanıcı', '$2b$10$Ya4uggSwY8yYX7S0NhHJ2eNuSnXWoxrS.k98hs.byD3FDxMzlT4cq', 'admin', NULL, true, '2026-03-14 20:45:31.143234');
INSERT INTO public.users (id, email, name, password_hash, role, company_id, is_active, created_at) VALUES (2, 'hr@techcorp.com', 'HR Manager', '$2b$10$5cI./WdfEus8lQdA9ZY34eYdxNpS07WpG5v7tZoL/kUTuEiUrntjK', 'client', 1, true, '2026-03-14 20:45:31.143234');
INSERT INTO public.users (id, email, name, password_hash, role, company_id, is_active, created_at) VALUES (3, 'vendor@staffingpro.com', 'Vendor User', '$2b$10$g81nSPKcpHzmzMmiwMe70.mLIOZA42Dn5lJ95/xnzXjd4CDjIvENG', 'vendor', 2, true, '2026-03-14 20:45:31.143234');


--
-- Data for Name: candidate_notes; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: contracts; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: timesheets; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Name: candidate_notes_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.candidate_notes_id_seq', 1, false);


--
-- Name: candidates_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.candidates_id_seq', 2, true);


--
-- Name: companies_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.companies_id_seq', 2, true);


--
-- Name: contracts_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.contracts_id_seq', 1, false);


--
-- Name: job_roles_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.job_roles_id_seq', 3, true);


--
-- Name: timesheets_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.timesheets_id_seq', 1, false);


--
-- Name: users_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.users_id_seq', 3, true);


--
-- PostgreSQL database dump complete
--

\unrestrict ymO2s4CxkA9GXLJd3ubBDUsTetsAUXGfH8k99oIGccqiByLYbW53BhshlA3WzMq
