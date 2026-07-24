-- MySQL initialization script
-- Database and user creation for Docker startup

CREATE DATABASE IF NOT EXISTS dialer CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'dialer'@'%' IDENTIFIED BY 'changeme';
GRANT ALL PRIVILEGES ON dialer.* TO 'dialer'@'%';
FLUSH PRIVILEGES;
