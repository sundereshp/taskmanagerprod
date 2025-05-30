const mysql = require('mysql2/promise');
require('dotenv').config();

// Create a connection pool with SSL configuration
const poolConfig = {
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'vwSrv',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'vwSrv',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    ssl: null // Default to no SSL
};

// Only enable SSL if explicitly configured
if (process.env.DB_SSL === 'true') {
    poolConfig.ssl = {
        rejectUnauthorized: false
    };
}

const pool = mysql.createPool(poolConfig);

// Test the connection
async function testConnection() {
    try {
        const connection = await pool.getConnection();
        console.log('Successfully connected to MySQL database');
        connection.release();
        return true;
    } catch (error) {
        console.error('Error connecting to MySQL database:', error);
        return false;
    }
}

// Initialize database tables
async function initializeDatabase() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS projects (
                id INT AUTO_INCREMENT PRIMARY KEY,
                userID INT NOT NULL,
                name VARCHAR(255) NOT NULL,
                description TEXT,
                startDate DATETIME NOT NULL,
                endDate DATETIME NOT NULL,
                estHours FLOAT DEFAULT 0,
                actHours FLOAT DEFAULT 0,
                wsID INT NOT NULL,
                createdAt DATETIME NOT NULL,
                modifiedAt DATETIME NOT NULL,
                INDEX (wsID),
                INDEX (userID)
            )
        `);


        await pool.query(`
            CREATE TABLE IF NOT EXISTS tasks (
                id INT AUTO_INCREMENT PRIMARY KEY,
                wsID INT NOT NULL,
                userID INT NOT NULL,
                projectID INT NOT NULL,
                name VARCHAR(255) NOT NULL,
                description TEXT,
                taskLevel TINYINT NOT NULL DEFAULT 1,
                status VARCHAR(50) DEFAULT 'todo',
                parentID INT DEFAULT 0,
                level1ID INT DEFAULT 0,
                level2ID INT DEFAULT 0,
                level3ID INT DEFAULT 0,
                level4ID INT DEFAULT 0,
                assignee1ID INT DEFAULT 0,
                assignee2ID INT DEFAULT 0,
                assignee3ID INT DEFAULT 0,
                estHours FLOAT DEFAULT 0,
                estPrevHours JSON,
                actHours FLOAT DEFAULT 0,
                isExceeded TINYINT DEFAULT 0,
                priority VARCHAR(20) DEFAULT 'low',
                info JSON,
                taskType VARCHAR(50) DEFAULT 'task',
                dueDate DATETIME,
                comments TEXT,
                createdAt DATETIME NOT NULL,
                modifiedAt DATETIME NOT NULL,
                FOREIGN KEY (projectID) REFERENCES projects(id) ON DELETE CASCADE,
                INDEX (projectID),
                INDEX (parentID),
                INDEX (level1ID),
                INDEX (level2ID),
                INDEX (level3ID),
                INDEX (level4ID)
            )
        `);


        console.log('Database tables initialized');
        
        // Check and add missing columns if they don't exist
        try {
            // Add isExceeded column if it doesn't exist
            await pool.query(`
                SELECT COUNT(*) 
                FROM INFORMATION_SCHEMA.COLUMNS 
                WHERE TABLE_NAME = 'tasks' 
                AND COLUMN_NAME = 'isExceeded'
            `).then(async ([rows]) => {
                if (rows[0]['COUNT(*)'] === 0) {
                    await pool.query('ALTER TABLE tasks ADD COLUMN isExceeded TINYINT DEFAULT 0');
                    console.log('Added isExceeded column to tasks table');
                }
            });

            // Add expanded column if it doesn't exist
            await pool.query(`
                SELECT COUNT(*) 
                FROM INFORMATION_SCHEMA.COLUMNS 
                WHERE TABLE_NAME = 'tasks' 
                AND COLUMN_NAME = 'expanded'
            `).then(async ([rows]) => {
                if (rows[0]['COUNT(*)'] === 0) {
                    await pool.query('ALTER TABLE tasks ADD COLUMN expanded BOOLEAN DEFAULT TRUE');
                    console.log('Added expanded column to tasks table');
                }
            });
            
        } catch (alterError) {
            console.error('Error updating table schema:', alterError);
            // Don't throw the error to allow the server to start
        }
    } catch (error) {
        console.error('Error initializing database:', error);
        throw error;
    }
}

module.exports = {
    pool,
    testConnection,
    initializeDatabase
};
