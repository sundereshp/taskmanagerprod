import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { ActionItem, Priority, Project, Status, Subtask, Task, TimerInfo, User, SubactionItem, TaskType } from "../types/task";
import { addDays } from "date-fns";
import toast from 'react-hot-toast'; // Import toast

// Sample user data
const users: User[] = [
  { id: "1", name: "John Doe" },
  { id: "2", name: "Jane Williams Smith" },
  { id: "3", name: "Mike Johnson" },
  { id: "4", name: "Amy Chen" },
  { id: "5", name: "Bob Wilson" },
  { id: "6", name: "Chris Lee" },
];

interface TaskContextType {
  projects: Project[];
  users: User[];
  timer: TimerInfo;
  selectedProject: Project | null;
  addProject: (name: string) => void;
  updateProject: (projectId: string, name: string, description: string, startDate: string, endDate: string, estHours: number, actHours: number) => void;
  deleteProject: (projectId: string) => void;
  renameProject: (projectId: string, name: string) => void;
  duplicateProject: (projectId: string) => void;
  selectProject: (projectId: string | null) => void;
  addTask: (projectId: string, name: string, status?: Status, taskType?: TaskType) => void;
  updateTask: (projectId: string, taskId: string, updates: Partial<Task>) => void;
  addSubtask: (projectId: string, taskId: string, name: string, status?: Status, taskType?: TaskType) => void;
  updateSubtask: (projectId: string, taskId: string, subtaskId: string, updates: Partial<Subtask>) => void;
  addActionItem: (projectId: string, taskId: string, subtaskId: string, name: string, status?: Status, taskType?: TaskType) => void;
  updateActionItem: (projectId: string, taskId: string, subtaskId: string, actionItemId: string, updates: Partial<ActionItem>) => void;
  addSubactionItem: (projectId: string, taskId: string, subtaskId: string, actionItemId: string, name: string, status?: Status, taskType?: TaskType) => void;
  updateSubactionItem: (projectId: string, taskId: string, subtaskId: string, actionItemId: string, subactionItemId: string, updates: Partial<SubactionItem>) => void;
  toggleExpanded: (projectId: string, taskId: string, type: "task" | "subtask" | "actionItem" | "subactionItem", subtaskId?: string, actionItemId?: string, subactionItemId?: string) => void;
  startTimer: (projectId: string, actionItemId: string) => void;
  deleteItem: (projectId: string, itemId: string) => void;
  stopTimer: () => void;
  getUserById: (id: string | null) => User | undefined;
  updateItem: (itemId: string, updates: any) => void;

}

const TaskContext = createContext<TaskContextType | undefined>(undefined);

export function TaskProvider({ children }: { children: React.ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [timer, setTimer] = useState<TimerInfo>({
    projectId: null,
    taskId: null,
    subtaskId: null,
    actionItemId: null,
    subactionItemId: null,
    startTime: null,
    isActive: false,
    isRunning: false
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const API_PREFIX = '/su/backend';
  useEffect(() => {
    const fetchProjects = async () => {
      try {
        const response = await fetch(API_PREFIX + '/projects');
        if (!response.ok) throw new Error('Failed to fetch projects');
        const fetchedProjects = await response.json();
        setProjects(fetchedProjects);

        // If no projects exist, create a default one
        if (fetchedProjects.length === 0) {
          const defaultProject = await addProject('Default Project', '');
          setSelectedProjectId(defaultProject.id);
        } else {
          // Select the first project by default
          setSelectedProjectId(fetchedProjects[0].id);
        }

        setIsLoading(false);
      } catch (err) {
        console.error('Error fetching projects:', err);
        setError('Failed to fetch projects');
        setIsLoading(false);
      }
    };
    fetchProjects();
  }, []);

  useEffect(() => {
    const fetchProjects = async () => {
      try {
        const response = await fetch(API_PREFIX + '/projects');
        if (!response.ok) throw new Error('Failed to fetch projects');

        const projects = await response.json();
        setProjects(projects);

        // If there's a selected project, fetch its tasks
        if (selectedProjectId) {
          fetchTasks(selectedProjectId);
        }
      } catch (error) {
        console.error('Error fetching projects:', error);
        setError('Failed to load projects');
      } finally {
        setIsLoading(false);
      }
    };

    fetchProjects();
  }, [selectedProjectId]);

  // Updated buildTaskTree function
  function buildTaskTree(tasks: any[]) {
    const tasksById: Record<string, any> = {};
    const rootTasks: any[] = [];

    tasks.forEach(task => {
      tasksById[task.id] = {
        ...task,
        subtasks: [],
        actionItems: [],
        subactionItems: []
      };
      if (task.dueDate) {
        task.dueDate = new Date(task.dueDate);
      }
    });

    tasks.forEach(task => {
      if (task.level4ID !== 0) {
        const parent = tasksById[task.level3ID];
        if (parent) parent.subactionItems.push(tasksById[task.id]);
      } else if (task.level3ID !== 0) {
        const parent = tasksById[task.level2ID];
        if (parent) parent.actionItems.push(tasksById[task.id]);
      } else if (task.level2ID !== 0) {
        const parent = tasksById[task.level1ID];
        if (parent) parent.subtasks.push(tasksById[task.id]);
      } else {
        rootTasks.push(tasksById[task.id]);
      }
    });

    return rootTasks;
  }


  const fetchTasks = async (projectId: string) => {
    try {
      const response = await fetch(`${API_PREFIX}/tasks/project/${projectId}`);
      if (!response.ok) throw new Error('Failed to fetch tasks');

      const tasks = await response.json();
      const tree = buildTaskTree(tasks);

      setProjects(prevProjects =>
        prevProjects.map(project =>
          project.id === projectId ? { ...project, tasks: tree } : project
        )
      );
    } catch (err) {
      console.error('Error fetching tasks:', err);
      throw err;
    }
  };

  const selectedProject = projects.find(p => p.id === selectedProjectId) || null;

  const addProject = async (name: string, description: string = '') => {
    try {
      const response = await fetch(`${API_PREFIX}/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userID: 1,
          name,
          description,
          startDate: new Date().toISOString(),
          endDate: addDays(new Date(), 30).toISOString(),
          wsID: 1
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to create project');
      }

      const createdProject = await response.json();
      setProjects(prev => [...prev, createdProject]);

      // Select the newly created project
      setSelectedProjectId(createdProject.id);

      return createdProject;
    } catch (err) {
      console.error('Error adding project:', err);
      throw err;
    }
  };

  const updateProject = async (
    projectId: string, 
    name: string, 
    description: string, 
    startDate: string, 
    endDate: string, 
    estHours: number, 
    actHours: number
  ) => {
    try {
      const response = await fetch(`${API_PREFIX}/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description,
          startDate: new Date(startDate).toISOString(),
          endDate: new Date(endDate).toISOString(),
          estHours,
          actHours
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to update project');
      }

      const updatedProject = await response.json();
      
      // Update the projects list with the updated project
      setProjects(prev =>
        prev.map(project => project.id === updatedProject.id ? updatedProject : project)
      );
      
      
      return updatedProject;
    } catch (err) {
      console.error('Error updating project:', err);
      throw err;
    }
  };

  const renameProject = async (projectId: string, name: string) => {
    try {
      const response = await fetch(`${API_PREFIX}/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });

      if (!response.ok) throw new Error('Failed to rename project');

      const updatedProject = await response.json();
      setProjects(prev =>
        prev.map(project => project.id === updatedProject.id ? updatedProject : project)
      );
    } catch (err) {
      console.error('Error renaming project:', err);
    }
  };

  const deleteProject = async (projectId: string) => {
    try {
      const response = await fetch(`${API_PREFIX}/projects/${projectId}`, {
        method: 'DELETE'
      });

      if (!response.ok) throw new Error('Failed to delete project');

      setProjects(prev => prev.filter(project => project.id !== projectId));

      if (selectedProjectId === projectId) {
        setSelectedProjectId(projects.length > 1 ? projects[0].id : null);
      }
    } catch (err) {
      console.error('Error deleting project:', err);
    }
  };

  const duplicateProject = async (projectId: string) => {
    try {
      const sourceProject = projects.find(p => p.id === projectId);
      if (!sourceProject) throw new Error('Project not found');

      // Extract base name by removing any existing number in parentheses
      const baseName = sourceProject.name.replace(/\s*\(\d+\)$/, '').trim();

      // Find all existing project names that match the base name pattern
      const existingNumbers: number[] = [];
      const projectNamePattern = new RegExp(`^${escapeRegExp(baseName)}(?:\s*\((\d+)\))?$`);

      projects.forEach(project => {
        const match = project.name.match(projectNamePattern);
        if (match) {
          if (match[1]) {
            // If there's a number in parentheses, add it to our list
            existingNumbers.push(parseInt(match[1], 10));
          } else if (project.name === baseName) {
            // If it's exactly the base name (no number), count it as (1)
            existingNumbers.push(0);
          }
        }
      });

      // Find the lowest unused positive integer
      let nextNumber = 1;
      while (existingNumbers.includes(nextNumber)) {
        nextNumber++;
      }

      // Create the new project name with the next available number
      let newProjectName = `${baseName} (${nextNumber})`;

      // Check if the new project name already exists
      while (projects.some(project => project.name === newProjectName)) {
        nextNumber++;
        newProjectName = `${baseName} (${nextNumber})`;
      }

      // Show loading state
      toast.loading('Creating project copy...');

      // Create the new project via API
      const projectResponse = await fetch(`${API_PREFIX}/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userID: 1,
          name: newProjectName,
          description: sourceProject.description || '',
          startDate: sourceProject.startDate || new Date().toISOString(),
          endDate: sourceProject.endDate || addDays(new Date(), 30).toISOString(),
          estHours: sourceProject.estHours || 0,
          actHours: 0, // Reset actual hours for the new project
          wsID: 1
        })
      });

      if (!projectResponse.ok) throw new Error('Failed to create project copy');

      const newProject = await projectResponse.json();
      toast.loading('Copying tasks...');

      // Fetch all tasks for the source project
      const tasksResponse = await fetch(`${API_PREFIX}/tasks/project/${projectId}`);
      if (!tasksResponse.ok) throw new Error('Failed to fetch tasks for duplication');

      const tasks = await tasksResponse.json();

      // Create a map to track old task IDs to new task IDs
      const idMap = new Map<string, string>();

      // Sort tasks by level to ensure parents are created before their children
      const sortedTasks = [...tasks].sort((a, b) => a.taskLevel - b.taskLevel);

      // Function to create a task and return its new ID
      const createTask = async (task: any, parentId: string | null = null) => {
        const { id: oldId, ...taskData } = task;
        
        // Prepare the task data for the new project
        const newTask = {
          ...taskData,
          projectID: parseInt(newProject.id),
          parentID: parentId ? parseInt(idMap.get(parentId) || '0') : 0,
          // Reset task state
          timerStart: null,
          timeSpent: 0,
          status: task.status === 'completed' ? 'todo' : task.status,
          completedAt: null,
          completedBy: null
        };

        const response = await fetch(`${API_PREFIX}/tasks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newTask)
        });

        if (!response.ok) throw new Error('Failed to create task');

        const createdTask = await response.json();
        idMap.set(oldId, createdTask.id);
        return createdTask.id;
      };

      // First, create all tasks while maintaining their hierarchy
      for (const task of sortedTasks) {
        // If this is a top-level task, create it with no parent
        if (task.taskLevel === 1) {
          await createTask(task);
        } 
        // If this is a subtask, find its parent and create it with the correct parent ID
        else if (task.parentID && idMap.has(task.parentID)) {
          await createTask(task, task.parentID);
        }
        // If parent mapping isn't available yet, skip and try again later
        // This should theoretically not happen due to sorting by taskLevel
      }


      // Refresh the projects list to include the new project
      const updatedProjectsResponse = await fetch(`${API_PREFIX}/projects`);
      if (!updatedProjectsResponse.ok) throw new Error('Failed to fetch updated projects');

      const updatedProjects = await updatedProjectsResponse.json();
      setProjects(updatedProjects);

      // Select the new project
      setSelectedProjectId(newProject.id);
      
      // Refresh the tasks for the new project
      await fetchTasks(newProject.id);

      toast.dismiss();
      toast.success('Project duplicated successfully');
    } catch (err) {
      console.error('Error duplicating project:', err);
      toast.dismiss();
      toast.error(err instanceof Error ? err.message : 'Failed to duplicate project');
      throw err; // Re-throw to allow error handling in the component
    }
  };

  const selectProject = (projectId: string | null) => {
    setSelectedProjectId(projectId);
  };

  const addTask = async (projectId: string, name: string, status: Status = 'todo', taskType: TaskType = 'task') => {
    if (!name.trim()) return;

    const newTaskPayload = {
      name,
      wsID: 1,
      userID: 1,
      projectID: parseInt(projectId),
      taskLevel: 1,
      status,
      taskType: 'task', // Explicitly set default task type
      parentID: parseInt(projectId),  // Set parentID to project ID for top-level tasks
      level1ID: 0,
      level2ID: 0,
      level3ID: 0,
      level4ID: 0,
      assignee1ID: 0,
      assignee2ID: 0,
      assignee3ID: 0,
      estHours: 0,
      estPrevHours: 0,
      actHours: 0,
      isExceeded: 0,
      info: {},
      description: ''
    };

    try {
      const response = await fetch(`${API_PREFIX}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newTaskPayload)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to create task');
      }

      const createdTask = await response.json();
      await fetchTasks(projectId);
      toast.success('Task created successfully');
      return createdTask;
    } catch (err) {
      console.error('Error adding task:', err);
      toast.error('Failed to create task');
      throw err;
    }
  };

  const updateTask = useCallback(async (projectId: string, taskId: string, updates: Partial<Task>) => {
    try {
      // Track previous estimate if changing estHours
      if (updates.estHours !== undefined) {
        const currentEstimate = selectedProject?.tasks.find(t => t.id === taskId)?.estHours;
        if (currentEstimate !== updates.estHours) {
          updates.estPrevHours = currentEstimate || 0; // Store only the previous value
        }
      }

      // Update the task
      const response = await fetch(`${API_PREFIX}/tasks/${taskId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });

      if (!response.ok) throw new Error('Failed to update task');

      const updatedTask = await response.json();
      setProjects(projects.map(project =>
        project.id === projectId ? {
          ...project,
          tasks: project.tasks.map(task =>
            task.id === taskId ? { ...task, ...updatedTask, subtaskCount: task.subtaskCount } : task
          )
        } : project
      ));
      toast.success('Task updated successfully');
    } catch (error) {
      console.error('Error updating task:', error);
      toast.error('Failed to update task');
    }
  }, [selectedProject, projects]);

  const addSubtask = async (projectId: string, taskId: string, name: string, status: Status = 'todo', taskType: TaskType = 'task') => {
    if (!name.trim()) return;

    const newSubtaskPayload = {
      name,
      wsID: 1,
      userID: 1,
      projectID: parseInt(projectId),
      taskLevel: 2,
      status,
      taskType,
      parentID: parseInt(taskId),
      // Level IDs will be set by backend
    };

    try {
      const response = await fetch(`${API_PREFIX}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSubtaskPayload)
      });

      const createdSubtask = await response.json();
      await fetchTasks(projectId); // Refresh tasks after creation
      toast.success('Subtask created successfully');
      return createdSubtask;
    } catch (err) {
      console.error('Error adding subtask:', err);
      toast.error('Failed to create subtask');
      throw err;
    }
  };

  const updateSubtask = async (projectId: string, taskId: string, subtaskId: string, updates: Partial<Subtask>) => {
    try {
      const response = await fetch(`${API_PREFIX}/tasks/${subtaskId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });

      if (!response.ok) throw new Error('Failed to update subtask');

      setProjects(projects.map(project => {
        if (project.id === projectId) {
          return {
            ...project,
            tasks: project.tasks.map(task => {
              if (task.id === taskId) {
                return {
                  ...task,
                  subtasks: task.subtasks.map(subtask =>
                    subtask.id === subtaskId ? { ...subtask, ...updates } : subtask
                  )
                };
              }
              return task;
            })
          };
        }
        return project;
      }));
    } catch (err) {
      console.error('Error updating subtask:', err);
      throw err;
    }
  };

  const addActionItem = async (projectId: string, taskId: string, subtaskId: string, name: string, status: Status = 'todo', taskType: TaskType = 'task') => {
    try {
      const newActionItemPayload = {
        name,
        wsID: 1,
        userID: 1,
        projectID: parseInt(projectId),
        taskLevel: 3,
        status,
        taskType,
        parentID: parseInt(subtaskId),
      };

      const response = await fetch(`${API_PREFIX}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newActionItemPayload)
      });

      const createdActionItem = await response.json();
      await fetchTasks(projectId); // Refresh tasks after creation
      toast.success('Action item created successfully');
      return createdActionItem;
    } catch (err) {
      console.error('Error adding action item:', err);
      toast.error('Failed to create action item');
      throw err;
    }
  };

  const updateActionItem = async (
    projectId: string,
    taskId: string,
    subtaskId: string,
    actionItemId: string,
    updates: Partial<ActionItem>
  ) => {
    try {
      // Preserve the current expanded state
      const currentProject = projects.find(p => p.id === projectId);
      const currentTask = currentProject?.tasks.find(t => t.id === taskId);
      const currentSubtask = currentTask?.subtasks.find(s => s.id === subtaskId);
      const currentActionItem = currentSubtask?.actionItems.find(a => a.id === actionItemId);

      // If we're not explicitly setting expanded, preserve the current state
      if (updates.expanded === undefined && currentActionItem) {
        updates.expanded = currentActionItem.expanded;
      }

      const response = await fetch(`${API_PREFIX}/tasks/${actionItemId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to update action item');
      }

      const updatedActionItem = await response.json();

      // Update the state with the server's response
      setProjects(projects.map(project => {
        if (project.id === projectId) {
          return {
            ...project,
            tasks: project.tasks.map(task => {
              if (task.id === taskId) {
                return {
                  ...task,
                  subtasks: task.subtasks.map(subtask => {
                    if (subtask.id === subtaskId) {
                      return {
                        ...subtask,
                        actionItems: subtask.actionItems.map(ai =>
                          ai.id === actionItemId ? { ...ai, ...updatedActionItem } : ai
                        )
                      };
                    }
                    return subtask;
                  })
                };
              }
              return task;
            })
          };
        }
        return project;
      }));

    } catch (err) {
      console.error('Error updating action item:', err);
      throw err;
    }
  };

  const addSubactionItem = async (
    projectId: string,
    taskId: string,
    subtaskId: string,
    actionItemId: string,
    name: string,
    status: Status = 'todo',
    taskType: TaskType = 'task'
  ) => {
    try {
      // First, ensure the parent action item is expanded
      await updateActionItem(projectId, taskId, subtaskId, actionItemId, { expanded: true });

      // Then add the new subaction item
      const newSubactionPayload = {
        name,
        wsID: 1,
        userID: 1,
        projectID: parseInt(projectId),
        taskLevel: 4,
        status,
        taskType,
        parentID: parseInt(actionItemId),
      };

      const response = await fetch(`${API_PREFIX}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSubactionPayload)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to create subaction item');
      }

      const createdSubaction = await response.json();

      // Refresh the tasks to get the latest state
      await fetchTasks(projectId);

      toast.success('Subaction item created successfully');
      return createdSubaction;
    } catch (err) {
      console.error('Error adding subaction item:', err);
      toast.error('Failed to create subaction item');
      throw err;
    }
  };

  const updateSubactionItem = async (
    projectId: string,
    taskId: string,
    subtaskId: string,
    actionItemId: string,
    subactionItemId: string,
    updates: Partial<SubactionItem>
  ) => {
    try {
      const response = await fetch(`${API_PREFIX}/tasks/${subactionItemId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });

      if (!response.ok) throw new Error('Failed to update subaction item');

      setProjects(projects.map(project => {
        if (project.id === projectId) {
          return {
            ...project,
            tasks: project.tasks.map(task => {
              if (task.id === taskId) {
                return {
                  ...task,
                  subtasks: task.subtasks.map(subtask => {
                    if (subtask.id === subtaskId) {
                      return {
                        ...subtask,
                        actionItems: subtask.actionItems.map(actionItem => {
                          if (actionItem.id === actionItemId) {
                            return {
                              ...actionItem,
                              subactionItems: actionItem.subactionItems.map(subactionItem =>
                                subactionItem.id === subactionItemId ? { ...subactionItem, ...updates } : subactionItem
                              )
                            };
                          }
                          return actionItem;
                        })
                      };
                    }
                    return subtask;
                  })
                };
              }
              return task;
            })
          };
        }
        return project;
      }));
    } catch (err) {
      console.error('Error updating subaction item:', err);
      throw err;
    }
  };

  const updateItem = async (itemId: string, updates: any) => {
    try {
      const response = await fetch(`${API_PREFIX}/tasks/${itemId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });

      if (!response.ok) throw new Error('Failed to update item');

      // Refresh tasks after update
      if (selectedProjectId) {
        await fetchTasks(selectedProjectId);
      }
    } catch (err) {
      console.error('Error updating item:', err);
      throw err;
    }
  };

  // Unified delete function for all levels
  const deleteItem = async (projectId: string, itemId: string) => {
    try {
      const response = await fetch(`${API_PREFIX}/tasks/${itemId}`, {
        method: 'DELETE',
      });

      if (!response.ok) throw new Error('Failed to delete item');

      // Refresh tasks from backend
      await fetchTasks(projectId);

      toast.success('Item and all related subitems deleted successfully');
    } catch (err) {
      console.error('Error deleting item:', err);
      toast.error('Failed to delete item');
      throw err;
    }
  };

  const toggleExpanded = (
    projectId: string,
    taskId: string,
    type: "task" | "subtask" | "actionItem" | "subactionItem",
    subtaskId?: string,
    actionItemId?: string,
    subactionItemId?: string
  ) => {
    setProjects(projects.map(project => {
      if (project.id === projectId) {
        return {
          ...project,
          tasks: project.tasks.map(task => {
            // For tasks
            if (type === "task" && task.id === taskId) {
              return { ...task, expanded: !task.expanded };
            }

            // For subtasks
            if (type === "subtask" && subtaskId) {
              return {
                ...task,
                subtasks: task.subtasks.map(subtask =>
                  subtask.id === subtaskId
                    ? { ...subtask, expanded: !subtask.expanded }
                    : subtask
                )
              };
            }

            // For action items
            if (type === "actionItem" && subtaskId && actionItemId) {
              return {
                ...task,
                subtasks: task.subtasks.map(subtask =>
                  subtask.id === subtaskId
                    ? {
                      ...subtask,
                      actionItems: subtask.actionItems.map(actionItem =>
                        actionItem.id === actionItemId
                          ? { ...actionItem, expanded: !actionItem.expanded }
                          : actionItem
                      )
                    }
                    : subtask
                )
              };
            }

            // For subaction items
            if (type === "subactionItem") {
              // Subaction items don't have children to expand/collapse
              // So we don't need to do anything here
              return task;
            }

            return task;
          })
        };
      }
      return project;
    }));
  };

  const startTimer = (projectId: string, actionItemId: string) => {
    setTimer({
      projectId,
      taskId: null,
      subtaskId: null,
      actionItemId,
      subactionItemId: null,
      startTime: new Date(),
      isActive: true,
      isRunning: true
    });
  };

  const stopTimer = () => {
    if (timer.isRunning && timer.startTime && timer.projectId && timer.actionItemId) {
      const endTime = new Date();
      const timeSpent = Math.floor((endTime.getTime() - timer.startTime.getTime()) / 60000); // minutes

      projects.forEach(project => {
        if (project.id === timer.projectId) {
          project.tasks.forEach(task => {
            task.subtasks.forEach(subtask => {
              subtask.actionItems.forEach(actionItem => {
                if (actionItem.id === timer.actionItemId) {
                  updateActionItem(
                    project.id,
                    task.id,
                    subtask.id,
                    actionItem.id,
                    { timeSpent: actionItem.timeSpent + timeSpent }
                  );
                }
              });
            });
          });
        }
      });
    }

    setTimer({
      projectId: null,
      taskId: null,
      subtaskId: null,
      actionItemId: null,
      subactionItemId: null,
      startTime: null,
      isActive: false,
      isRunning: false
    });
  };

  const getUserById = (id: string | null) => {
    if (!id) return undefined;
    return users.find(user => user.id === id);
  };

  useEffect(() => {
    const updatedTasks = projects.map(project => ({
      ...project,
      tasks: project.tasks?.map(task => ({
        ...task,
        subtaskCount: project.tasks?.filter(t => t.parentID === parseInt(task.id)).length || 0
      })) || []
    }));
    setProjects(updatedTasks);
  }, [projects]);

  return (
    <TaskContext.Provider value={{
      projects,
      users,
      timer,
      selectedProject,
      addProject,
      updateProject,
      deleteProject,
      renameProject,
      duplicateProject,
      selectProject,
      addTask,
      updateTask,
      addSubtask,
      updateSubtask,
      addActionItem,
      updateActionItem,
      addSubactionItem,
      updateSubactionItem,
      deleteItem,
      toggleExpanded,
      startTimer,
      stopTimer,
      getUserById,
      updateItem
    }}>
      {children}
    </TaskContext.Provider>
  );
}

export const useTaskContext = (): TaskContextType => {
  const context = useContext(TaskContext);
  if (!context) {
    throw new Error("useTaskContext must be used within a TaskProvider");
  }
  return context;
};

function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}
