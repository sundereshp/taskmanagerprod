require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { pool, testConnection, initializeDatabase } = require('./db');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Add logging middleware
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// Test database connection on startup
async function startServer(port) {
    const server = app.listen(port)
        .on('error', async (err) => {
            if (err.code === 'EADDRINUSE') {
                console.log(`Port ${port} is in use, trying port ${port + 1}...`);
                // Try the next port
                await startServer(port + 1);
            } else {
                console.error('Server error:', err);
                process.exit(1);
            }
        })
        .on('listening', () => {
            console.log(`Server running on port ${port}`);
        });

    try {
        const isConnected = await testConnection();
        if (!isConnected) {
            console.error('Failed to connect to database. Exiting...');
            process.exit(1);
        }
        
        await initializeDatabase();
        
    } catch (error) {
        console.error('Failed to start server:', error);
        server.close();
        process.exit(1);
    }
}

// Start the server with the port from .env or default to 3103
const PORT = process.env.PORT || 5000;
startServer(parseInt(PORT));

// Base API path
const API_PREFIX = '/su/backend';

// GET all projects
app.get(`${API_PREFIX}/projects`, async (req, res) => {
    try {
        const [projects] = await pool.query('SELECT * FROM projects ORDER BY id');
        res.json(projects);
    } catch (error) {
        console.error('Error fetching projects:', error);
        res.status(500).json({ error: 'Failed to fetch projects' });
    }
});

// GET single project with its tasks
app.get(`${API_PREFIX}/projects/:id`, async (req, res) => {
    try {
        const [projects] = await pool.query('SELECT * FROM projects WHERE id = ?', [req.params.id]);
        if (projects.length === 0) {
            return res.status(404).json({ error: 'Project not found' });
        }
        
        const [tasks] = await pool.query('SELECT * FROM tasks WHERE projectID = ?', [req.params.id]);
        const project = { ...projects[0], tasks };
        res.json(project);
    } catch (error) {
        console.error('Error fetching project:', error);
        res.status(500).json({ error: 'Failed to fetch project' });
    }
});

// POST create new project
app.post(`${API_PREFIX}/projects`, async (req, res) => {
    try {
        const requiredFields = ['userID', 'name', 'startDate', 'endDate', 'wsID'];
        const missing = requiredFields.filter(field => !req.body[field]);

        if (missing.length > 0) {
            return res.status(400).json({
                error: `Missing required fields: ${missing.join(', ')}`
            });
        }

        const { description, userID, name, startDate, endDate, estHours = 0, actHours = 0, wsID } = req.body;
        const now = new Date();
        
        // Format dates for MySQL (YYYY-MM-DD HH:MM:SS)
        const formatDateForMySQL = (date) => {
            const d = new Date(date);
            return d.toISOString().slice(0, 19).replace('T', ' ');
        };
        
        const [result] = await pool.query(
            'INSERT INTO projects (userID, name, description, startDate, endDate, estHours, actHours, wsID, createdAt, modifiedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
                userID, 
                name, 
                description, 
                formatDateForMySQL(startDate), 
                formatDateForMySQL(endDate), 
                estHours, 
                actHours, 
                wsID, 
                formatDateForMySQL(now), 
                formatDateForMySQL(now)
            ]
        );

        // Get the newly created project
        const [newProject] = await pool.query('SELECT * FROM projects WHERE id = ?', [result.insertId]);
        
        // Initialize with empty tasks array
        const response = { ...newProject[0], tasks: [] };
        
        res.status(201).json(response);
    } catch (error) {
        console.error('Error creating project:', error);
        res.status(500).json({ 
            error: 'Failed to create project',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// PATCH update project
app.put(`${API_PREFIX}/projects/:id`, async (req, res) => {
    try {
        const projectId = req.params.id;
        const allowedUpdates = ['userID', 'name', 'description', 'startDate', 'endDate', 'estHours', 'actHours', 'wsID'];
        
        // Build the update query
        const updates = [];
        const values = [];
        
        for (const key of allowedUpdates) {
            if (req.body[key] !== undefined) {
                updates.push(`${key} = ?`);
                // Format date fields for MySQL
                if ((key === 'startDate' || key === 'endDate') && req.body[key]) {
                    values.push(formatDateForMySQL(new Date(req.body[key])));
                } else {
                    values.push(req.body[key]);
                }
            }
        }
        
        if (updates.length === 0) {
            return res.status(400).json({ error: 'No valid fields to update' });
        }
        
        // Add modifiedAt timestamp
        updates.push('modifiedAt = ?');
        values.push(new Date());
        
        // Add projectId for WHERE clause
        values.push(projectId);
        
        const query = `
            UPDATE projects 
            SET ${updates.join(', ')} 
            WHERE id = ?`;
            
        const [result] = await pool.query(query, values);
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Project not found' });
        }
        
        // Get the updated project
        const [updatedProject] = await pool.query('SELECT * FROM projects WHERE id = ?', [projectId]);
        if (updatedProject.length === 0) {
            return res.status(404).json({ error: 'Project not found after update' });
        }
        
        // Get all tasks for the project and build the hierarchy
        const [allTasks] = await pool.query('SELECT * FROM tasks WHERE projectID = ?', [projectId]);
        
        // Helper function to build the task hierarchy
        const buildTaskHierarchy = (parentId = 0, level = 1) => {
            const tasksAtLevel = allTasks
                .filter(task => task.parentID == parentId && task.taskLevel === level)
                .map(task => {
                    const taskData = {
                        ...task,
                        id: task.id.toString(),
                        estPrevHours: safeJsonParse(task.estPrevHours, []),
                        info: safeJsonParse(task.info, {}),
                        subtasks: []
                    };
                    
                    // If this is a task (level 1), add subtasks
                    if (level === 1) {
                        taskData.subtasks = buildTaskHierarchy(task.id, 2);
                    } 
                    // If this is a subtask (level 2), add action items
                    else if (level === 2) {
                        taskData.actionItems = buildTaskHierarchy(task.id, 3);
                    }
                    // If this is an action item (level 3), add subaction items
                    else if (level === 3) {
                        taskData.subactionItems = buildTaskHierarchy(task.id, 4);
                    }
                    
                    return taskData;
                });
                
            return tasksAtLevel;
        };
        
        // Format the project with the hierarchical tasks
        const project = {
            ...updatedProject[0],
            id: updatedProject[0].id.toString(),
            startDate: updatedProject[0].startDate ? new Date(updatedProject[0].startDate).toISOString() : null,
            endDate: updatedProject[0].endDate ? new Date(updatedProject[0].endDate).toISOString() : null,
            tasks: buildTaskHierarchy()
        };
        
        res.json(project);
    } catch (error) {
        console.error('Error updating project:', error);
        res.status(500).json({ error: 'Failed to update project' });
    }
});

// DELETE project
app.delete(`${API_PREFIX}/projects/:id`, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const projectId = req.params.id;
        
        // First, delete all tasks associated with the project
        await connection.query('DELETE FROM tasks WHERE projectID = ?', [projectId]);
        
        // Then delete the project
        const [result] = await connection.query('DELETE FROM projects WHERE id = ?', [projectId]);
        
        if (result.affectedRows === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Project not found' });
        }
        
        await connection.commit();
        res.json({ success: true });
    } catch (error) {
        await connection.rollback();
        console.error('Error deleting project:', error);
        res.status(500).json({ error: 'Failed to delete project' });
    } finally {
        connection.release();
    }
});

// GET all tasks
app.get('/api/tasks', async (req, res) => {
    try {
        const [tasks] = await pool.query('SELECT * FROM tasks');
        res.json(tasks);
    } catch (error) {
        console.error('Error fetching tasks:', error);
        res.status(500).json({ error: 'Failed to fetch tasks' });
    }
});

// POST create new task (including subtasks)
app.post(`${API_PREFIX}/tasks`, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        
        const {
            description, wsID, userID, projectID, name,
            taskLevel = 1, status = 'todo', parentID = 0,
            assignee1ID = 0, assignee2ID = 0, assignee3ID = 0,
            estHours = 0, estPrevHours = [], actHours = 0,
            isExceeded = 0, info = {}, taskType = 'task',
            priority = 'low', dueDate = null, comments = ''
        } = req.body;

        // Check if project exists
        const [projects] = await connection.query('SELECT id FROM projects WHERE id = ?', [projectID]);
        if (projects.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Project not found' });
        }

        // Initialize level IDs
        let level1ID = 0, level2ID = 0, level3ID = 0, level4ID = 0;

        // Handle hierarchy levels if this is not a top-level task
        if (taskLevel > 1 && parentID) {
            const [parentTasks] = await connection.query(
                'SELECT id, level1ID, level2ID, level3ID, level4ID, taskLevel FROM tasks WHERE id = ?',
                [parentID]
            );

            if (parentTasks.length === 0) {
                await connection.rollback();
                return res.status(400).json({ error: 'Parent task not found' });
            }

            const parent = parentTasks[0];
            
            // Set level IDs based on parent's level
            level1ID = parent.level1ID || (parent.taskLevel === 1 ? parent.id : 0);
            level2ID = parent.level2ID || (parent.taskLevel === 2 ? parent.id : 0);
            level3ID = parent.level3ID || (parent.taskLevel === 3 ? parent.id : 0);
            level4ID = parent.level4ID || (parent.taskLevel === 4 ? parent.id : 0);
            
            // For the current task level, we'll set its own ID after insertion
            if (taskLevel === 2) level2ID = 0;
            else if (taskLevel === 3) level3ID = 0;
            else if (taskLevel === 4) level4ID = 0;
        }

        // Insert the new task
        const now = new Date();
        const [result] = await connection.query(
            `INSERT INTO tasks (
                wsID, userID, projectID, name, description, taskLevel, status, parentID,
                level1ID, level2ID, level3ID, level4ID,
                assignee1ID, assignee2ID, assignee3ID,
                estHours, estPrevHours, actHours, isExceeded,
                priority, info, taskType, dueDate, comments,
                createdAt, modifiedAt
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                wsID, userID, projectID, name, description, taskLevel, status, parentID || 0,
                level1ID, level2ID, level3ID, level4ID,
                assignee1ID || 0, assignee2ID || 0, assignee3ID || 0,
                estHours, JSON.stringify(estPrevHours), actHours, isExceeded,
                priority, JSON.stringify(info || {}), taskType, dueDate, comments || '',
                now, now
            ]
        );

        const newTaskId = result.insertId;

        // Update the level IDs for the new task
        if (taskLevel === 1) {
            // For top-level tasks, set level1ID to its own ID
            await connection.query(
                'UPDATE tasks SET level1ID = ? WHERE id = ?',
                [newTaskId, newTaskId]
            );
        } else if (taskLevel === 2) {
            // For subtasks, set level2ID to its own ID
            await connection.query(
                'UPDATE tasks SET level2ID = ? WHERE id = ?',
                [newTaskId, newTaskId]
            );
        } else if (taskLevel === 3) {
            // For action items, set level3ID to its own ID
            await connection.query(
                'UPDATE tasks SET level3ID = ? WHERE id = ?',
                [newTaskId, newTaskId]
            );
        } else if (taskLevel === 4) {
            // For sub-actions, set level4ID to its own ID
            await connection.query(
                'UPDATE tasks SET level4ID = ? WHERE id = ?',
                [newTaskId, newTaskId]
            );
        }

        // Get the complete task with updated fields
        const [newTask] = await connection.query('SELECT * FROM tasks WHERE id = ?', [newTaskId]);
        
        if (newTask.length === 0) {
            throw new Error('Failed to retrieve created task');
        }
        
        await connection.commit();
        
        try {
            // Parse JSON fields with proper error handling
            const responseTask = {
                ...newTask[0],
                estPrevHours: newTask[0].estPrevHours ? JSON.parse(newTask[0].estPrevHours) : [],
                info: newTask[0].info ? JSON.parse(newTask[0].info) : {}
            };
            
            res.status(201).json(responseTask);
        } catch (parseError) {
            console.error('Error parsing task data:', parseError);
            // Return the task with default values if parsing fails
            res.status(201).json({
                ...newTask[0],
                estPrevHours: [],
                info: {}
            });
        }
    } catch (error) {
        await connection.rollback();
        console.error('Error creating task:', error);
        res.status(500).json({ 
            error: 'Failed to create task',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    } finally {
        if (connection && typeof connection.release === 'function') {
            await connection.release();
        }
    }
});

// GET tasks for a specific project
app.get(`${API_PREFIX}/tasks/project/:projectId`, async (req, res) => {
    try {
        const projectId = req.params.projectId;
        
        // Check if project exists
        const [projects] = await pool.query('SELECT id FROM projects WHERE id = ?', [projectId]);
        if (projects.length === 0) {
            return res.status(404).json({ error: 'Project not found' });
        }

        // Get all tasks for the project
        const [tasks] = await pool.query('SELECT * FROM tasks WHERE projectID = ?', [projectId]);
        
        // Parse JSON fields with error handling
        const parsedTasks = tasks.map(task => {
            try {
                return {
                    ...task,
                    estPrevHours: task.estPrevHours ? safeJsonParse(task.estPrevHours, []) : [],
                    info: task.info ? safeJsonParse(task.info, {}) : {}
                };
            } catch (parseError) {
                console.error('Error parsing task data for task ID', task.id, ':', parseError);
                return {
                    ...task,
                    estPrevHours: [],
                    info: {}
                };
            }
        });
        
        res.json(parsedTasks);
    } catch (error) {
        console.error('Error fetching project tasks:', error);
        res.status(500).json({ 
            error: 'Failed to fetch tasks',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Helper function to format date for MySQL (YYYY-MM-DD HH:MM:SS)
function formatDateForMySQL(date) {
    if (!date) return null;
    const d = new Date(date);
    return d.toISOString().slice(0, 19).replace('T', ' ');
}

// PUT update task
app.put(`${API_PREFIX}/tasks/:id`, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        
        const taskId = req.params.id;
        const updates = req.body;
        
        // First, get the current task
        const [tasks] = await connection.query('SELECT * FROM tasks WHERE id = ?', [taskId]);
        if (tasks.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Task not found' });
        }
        
        const currentTask = tasks[0];
        const updateFields = [];
        const values = [];
        
        // Build the update query
        const allowedUpdates = [
            'name', 'description', 'status', 'assignee1ID', 'assignee2ID', 'assignee3ID',
            'estHours', 'actHours', 'priority', 'dueDate', 'comments', 'taskType','expanded'
        ];
        
        for (const field of allowedUpdates) {
            if (updates[field] !== undefined) {
                updateFields.push(`${field} = ?`);
                // Format date fields for MySQL
                if (field === 'dueDate' && updates[field]) {
                    values.push(formatDateForMySQL(updates[field]));
                } else {
                    values.push(updates[field]);
                }
            }
        }
        
        // Handle estHours and estPrevHours for subtasks and their descendants
        if (updates.estHours !== undefined && currentTask.taskLevel > 1) {
            updateFields.push('estPrevHours = ?');
            values.push(JSON.stringify([currentTask.estHours]));
        }
        
        if (updateFields.length === 0) {
            await connection.rollback();
            return res.status(400).json({ error: 'No valid fields to update' });
        }
        
        // Add modifiedAt timestamp
        updateFields.push('modifiedAt = ?');
        values.push(new Date());
        
        // Add taskId for WHERE clause
        values.push(taskId);
        
        // Execute the update
        const query = `
            UPDATE tasks 
            SET ${updateFields.join(', ')}
            WHERE id = ?`;
            
        await connection.query(query, values);
        
        // Get the updated task
        const [updatedTasks] = await connection.query('SELECT * FROM tasks WHERE id = ?', [taskId]);
        
        if (updatedTasks.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Task not found after update' });
        }
        
        await connection.commit();
        
        // Parse JSON fields safely
        const updatedTask = {
            ...updatedTasks[0],
            estPrevHours: typeof updatedTasks[0].estPrevHours === 'string' 
                ? JSON.parse(updatedTasks[0].estPrevHours) 
                : (updatedTasks[0].estPrevHours || []),
            info: typeof updatedTasks[0].info === 'string' 
                ? JSON.parse(updatedTasks[0].info || '{}')
                : (updatedTasks[0].info || {})
        };
        
        res.json(updatedTask);
    } catch (error) {
        await connection.rollback();
        console.error('Error updating task:', error);
        res.status(500).json({ error: 'Failed to update task' });
    } finally {
        connection.release();
    }
});

// DELETE task
app.delete(`${API_PREFIX}/tasks/:id`, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        
        const taskId = req.params.id;
        
        // First, get the task to determine its level
        const [tasks] = await connection.query('SELECT * FROM tasks WHERE id = ?', [taskId]);
        if (tasks.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Task not found' });
        }
        
        const taskToDelete = tasks[0];
        const projectId = taskToDelete.projectID;
        
        // Determine which level ID to match based on the deleted task's level
        const levelMap = {
            1: 'level1ID',
            2: 'level2ID',
            3: 'level3ID',
            4: 'level4ID'
        };
        
        const targetField = levelMap[taskToDelete.taskLevel];
        if (!targetField) {
            await connection.rollback();
            return res.status(400).json({ error: 'Invalid task level' });
        }
        
        // Get all tasks in the project that are at the same or deeper level
        const [allTasks] = await connection.query('SELECT id, ' + targetField + ' FROM tasks WHERE projectID = ?', [projectId]);
        
        const idsToDelete = new Set([taskId]);
        
        // First pass: Get direct children
        allTasks.forEach(task => {
            if (task[targetField] == taskId) { // Using == for type coercion
                idsToDelete.add(task.id);
            }
        });
        
        // Subsequent passes: Find descendants of descendants
        let currentSize;
        do {
            currentSize = idsToDelete.size;
            allTasks.forEach(task => {
                if (idsToDelete.has(task[targetField]) && !idsToDelete.has(task.id)) {
                    idsToDelete.add(task.id);
                }
            });
        } while (currentSize !== idsToDelete.size);
        
        // Convert Set to array for SQL IN clause
        const idsToDeleteArray = Array.from(idsToDelete);
        
        // Delete all collected tasks
        await connection.query('DELETE FROM tasks WHERE id IN (?)', [idsToDeleteArray]);
        
        await connection.commit();
        
        res.json({ 
            success: true,
            deletedCount: idsToDelete.size
        });
    } catch (error) {
        await connection.rollback();
        console.error('Error deleting task:', error);
        res.status(500).json({ error: 'Failed to delete task' });
    } finally {
        connection.release();
    }
});

// Helper function to safely parse JSON
function safeJsonParse(jsonString, defaultValue) {
    // If it's already an object/array, return it as is
    if (typeof jsonString === 'object' && jsonString !== null) {
        return jsonString;
    }
    
    // If it's not a string, return the default value
    if (typeof jsonString !== 'string') {
        return defaultValue;
    }
    
    // If it's an empty string, return the default value
    if (jsonString.trim() === '') {
        return defaultValue;
    }
    
    try {
        const parsed = JSON.parse(jsonString);
        // If parsing succeeded but the result is null/undefined, return the default value
        return parsed === null || parsed === undefined ? defaultValue : parsed;
    } catch (e) {
        console.error('JSON parse error:', e);
        return defaultValue;
    }
}
