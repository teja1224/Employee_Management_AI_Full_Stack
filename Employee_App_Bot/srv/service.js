const cds = require('@sap/cds');
const { GoogleGenAI } = require('@google/genai');
const Groq = require('groq-sdk/index.js');
require('dotenv').config();

module.exports = cds.service.impl(async function (){
    const db = await cds.connect.to('db');

    // const { Employees, Departments, Projects } = this.entities;

    // Initialize Gemini and grok SDK with your API key
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });


    // Chatbot action implementation
    this.on('askEmployeeBot', async(req)=> {
        const { prompt } = req.data;
        if (!prompt) {
            return "Please provide a valid question.";
        }
        const text = (prompt || "").toLowerCase();

        try{
            // 1. Fetch relevant database context to ground the response
            const employees = await SELECT.from(Employees).columns(e => {
                e.name, e.role, e.email,
                e.department(d => d.name)
            });
            const projects = await SELECT.from(Projects);
            const departments = await SELECT.from(Departments);

            // 2. Build structured ground-truth context
            const companyData = {
                departments: departments,
                employees: employees,
                projects: projects
            };

            // 3. Construct System Prompt (RAG Pattern)
            const fullPrompt = `
                You are an enterprise HR & Operations Assistant inside an SAP system.
                Answer the user's question accurately using ONLY the live SAP HANA database records provided below.

                LIVE SAP HANA DATABASE CONTEXT:
                ${JSON.stringify(companyData, null, 2)}

                Rules:
                - If the requested information is not in the context, explicitly say: "I do not have enough data in the SAP database to answer that."
                - Keep your answer clear, concise, and professional.

                USER QUESTION:
                ${prompt}
                `;


                const candidateModels = ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-2.5-flash'];
                let responseText = null;
                for (const modelName of candidateModels) {
                try {
                    const response = await ai.models.generateContent({
                        model: modelName,
                        contents: fullPrompt
                    });
                    responseText = response.text;
                    if (responseText) break; // Successfully got a response!
                } catch (err) {
                    console.warn(`Model ${modelName} failed or unavailable. Trying next fallback...`);
                }
            }
            //     // 4. Call the free Gemini Flash model
            // const response = await ai.models.generateContent({
            //     model: 'gemini-3.8-flash',
            //     contents: fullPrompt
            // });

            // 5. Return natural language answer back to UI5 / client
            return response.text;

        }catch(error){
            console.error("Error processing bot request:", error);
            return "Sorry, I encountered an error retrieving data for your request.";
        }
    })


    // Handler 2: Dedicated Groq Handler (askGroqBot)
    //using FULL Context Ingestion method
    this.on('askGroqBot', async (req) => {
        const { prompt, history } = req.data;
        if (!prompt) return "Please provide a valid prompt.";

        try {
            // Fetch live SAP HANA Cloud context
            const companyData = await fetchDatabaseContext();

            // Call Groq "openai/gpt-oss-120b" model
            let groqMessages = [
                    {
                        role: "system",
                        content: `You are an enterprise SAP HR & Operations Assistant. 
                    Answer the user's question accurately using ONLY this database context: ${JSON.stringify(companyData)}

                    CRITICAL FORMATTING RULES FOR CHAT UI:
                    - DO NOT use markdown tables (| Column | Column |). They do not render correctly in the chat window.
                    - Instead, format employee lists and details using clean HTML bullet points (e.g., <ul><li><b>Name:</b> ... | <b>Email:</b> ...</li></ul>).
                    - Always include a friendly introductory and concluding conversational sentence.`
                    },
                    { role: "user", content: prompt }
                ]


            if(history){
                try {
                    const aHistory = JSON.parse(history)
                    aHistory.forEach(msg => {
                        if(msg.sender === 'You'){
                            groqMessages.push({ role: "user", content: msg.text })
                        }
                        else{
                            groqMessages.push({role : 'assistant', content: msg.text})
                        }
                    })
                } catch (error) {
                    console.warn("Could not parse chat history:", e);
                }
            }

            // 4. Append current user prompt
            groqMessages.push({ role: "user", content: prompt });

            // 5. Call Groq with full conversational context
            const chatCompletion = await groq.chat.completions.create({
                messages: groqMessages,
                model: "openai/gpt-oss-120b",
                temperature: 0.2
            });

            return chatCompletion.choices[0]?.message?.content || "No response received from Groq.";

        } catch (error) {
            console.error("Groq Handler Error:", error);
            return "Error calling Groq LLM model.";
        }
    });


    // Helper function to extract SAP HANA Cloud records
    async function fetchDatabaseContext() {
        const employees = await db.run(`
                SELECT 
                    e.name, 
                    e.email, 
                    e.role, 
                    e.salary, 
                    d.name AS departmentName 
                FROM my_company_Employees AS e
                LEFT JOIN my_company_Departments AS d 
                ON e.department_ID = d.ID
            `);
        const projects = await db.run(`SELECT title, description, budget FROM my_company_Projects`);
        const departments = await db.run(`SELECT name, code FROM my_company_Departments`);
        const employeeProjectDetails = await db.run(`SELECT * FROM my_company_EmployeeProjects`)
        return { departments, employees, projects,employeeProjectDetails };
    }


    // ==========================================
    // 1. DEFINE TOOLS (FUNCTIONS) FOR THE LLM
    // ==========================================
    const tools = [
        {
            type: "function",
            function: {
                name: "getAllEmployees",
                description: "Retrieve a list of all company employees along with their email,salary, role.",
                parameters: {
                    type: "object",
                    properties: {}
                }
            }
        },
        {
            type: "function",
            function: {
                name: "getAllDepartments",
                description: "Retrieve a list of all company departments along with their codes.",
                parameters: {
                    type: "object",
                    properties: {}
                }
            }
        },
        {
            type: "function",
            function: {
                name: "getAllProjects",
                description: "Retrieve a list of all company projects along with their budgets and descriptions.",
                parameters: {
                    type: "object",
                    properties: {}
                }
            }
        },

        {
            type: "function",
            function: {
                name: "getEmployeesByProject",
                description: "Retrieve a list of employees working on a specific project name or title.",
                parameters: {
                    type: "object",
                    properties: {
                        projectTitle: {
                            type: "string",
                            description: "The title or keyword of the project, e.g., Cloud Infrastructure, AI Copilot"
                        }
                    },
                    required: ["projectTitle"]
                }
            }
        },

        {
            type: "function",
            function: {
                name: "getProjectsByEmployee",
                description: "Retrieve a list of projects that a particular employee working.",
                parameters: {
                    type: "object",
                    properties: {
                        employeeName: {
                            type: "string",
                            description: "The name of the employee, e.g., sai bandi, alice ect."
                        }
                    },
                    required: ["employeeName"]
                }
            }
        },
        
        {
            type: "function",
            function: {
                name: "getEmployeesByDepartment",
                description: "Retrieve a list of employees working in a specific department.",
                parameters: {
                    type: "object",
                    properties: {
                        departmentName: {
                            type: "string",
                            description: "The name of the department, e.g., Engineering, Human Resources, Finance, Marketing"
                        }
                    },
                    required: ["departmentName"]
                }
            }
        },
        
        {
            type: "function",
            function: {
                name: "searchEmployeeByName",
                description: "Search for a specific employee by their name or partial name.",
                parameters: {
                    type: "object",
                    properties: {
                        nameQuery: {
                            type: "string",
                            description: "The name or keyword to search for."
                        }
                    },
                    required: ["nameQuery"]
                }
            }
        }
    ];

    // ==========================================
    // 2. MAP FUNCTION NAMES TO HANA DATABASE QUERIES
    // ==========================================
    const availableFunctions = {
        getAllEmployees: async () => {
            const results = await db.run(`SELECT name, email, role, salary FROM my_company_Employees`);
            return JSON.stringify(results);
        },

        getAllProjects: async () => {
            const results = await db.run(`SELECT title, description, budget FROM my_company_Projects`);
            return JSON.stringify(results);
        },

        getAllDepartments: async () => {
            const results = await db.run(`SELECT name, code FROM my_company_Departments`);
            return JSON.stringify(results);
        },

        getEmployeesByProject: async ({ projectTitle }) => {
            const results = await db.run(`
                SELECT e.name, e.email, e.role, e.salary, p.title AS projectTitle, d.name AS departmentName
                FROM my_company_Employees AS e
                JOIN my_company_EmployeeProjects AS ep ON ep.employee_ID = e.ID
                JOIN my_company_Projects AS p ON ep.project_ID = p.ID
                LEFT JOIN my_company_Departments AS d ON e.department_ID = d.ID
                WHERE LOWER(p.title) LIKE LOWER(?)
            `, [`%${projectTitle}%`]);
            return JSON.stringify(results);
        },

        getProjectsByEmployee: async ({ employeeName }) => {
            const results = await db.run(`
                SELECT p.title, p.description, p.budget, e.name AS employeeName
                FROM my_company_Projects AS p
                JOIN my_company_EmployeeProjects AS ep ON ep.project_ID = p.ID
                JOIN my_company_Employees AS e ON ep.employee_ID = e.ID
                WHERE LOWER(e.name) LIKE LOWER(?)
            `, [`%${employeeName}%`]);
            return JSON.stringify(results);
        },

        getEmployeesByDepartment: async ({ departmentName }) => {
            const results = await db.run(`
                SELECT e.name, e.email, e.role, e.salary, d.name AS departmentName 
                FROM my_company_Employees AS e
                LEFT JOIN my_company_Departments AS d ON e.department_ID = d.ID
                WHERE LOWER(d.name) LIKE LOWER(?)
            `, [`%${departmentName}%`]);
            return JSON.stringify(results);
        },

        searchEmployeeByName: async ({ nameQuery }) => {
            const results = await db.run(`
                SELECT e.name, e.email, e.role, e.salary, d.name AS departmentName 
                FROM my_company_Employees AS e
                LEFT JOIN my_company_Departments AS d ON e.department_ID = d.ID
                WHERE LOWER(e.name) LIKE LOWER(?)
            `, [`%${nameQuery}%`]);
            return JSON.stringify(results);
        }
    };

    // ==========================================
    // 3. CAP ACTION HANDLER WITH FUNCTION CALLING
    // ==========================================
    this.on('askGroqBot2', async (req) => {
        const { prompt, history } = req.data;
        if (!prompt) return "Please provide a valid prompt.";

        try {
            let messages = [
                {
                    role: "system",
                    content: `You are an enterprise SAP HR & Operations Assistant. Use the provided tool functions to fetch data from SAP HANA Cloud. Do not guess data; always call the appropriate tool.
                    CRITICAL FORMATTING RULES FOR CHAT UI:
                    - DO NOT use markdown tables (| Column | Column |). They do not render correctly in the chat window.
                    - Instead, format employee lists and details using clean HTML bullet points (e.g., <ul><li><b>Name:</b> ... | <b>Email:</b> ...</li></ul>).
                    - Always include a friendly introductory and concluding conversational sentence.`
                }
            ];

            // 1. Parse & Append Chat History
            if (history) {
                try {
                    const parsedHistory = JSON.parse(history);
                    parsedHistory.forEach(msg => {
                        if (msg.sender === "You") {
                            messages.push({ role: "user", content: msg.text });
                        } else if (msg.sender === "AI Copilot" && msg.text !== "Thinking...") {
                            messages.push({ role: "assistant", content: msg.text });
                        }
                    });
                } catch (e) {
                    console.warn("History parse warning:", e);
                }
            }

            // Append current prompt
            messages.push({ role: "user", content: prompt });

            // 2. Dynamic Tool Calling Loop
            let maxIterations = 5; // Safety limit against infinite loops
            let iterations = 0;

            while (iterations < maxIterations) {
                iterations++;

                // Call Groq API
                let response = await groq.chat.completions.create({
                    model: "openai/gpt-oss-120b",
                    messages: messages,
                    tools: tools,
                    tool_choice: "auto",
                    temperature: 0.1
                });

                let responseMessage = response.choices[0].message;

                // Check if model wants to invoke tool(s)
                if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
                    // Push assistant's intent (which contains tool_calls) into history
                    messages.push(responseMessage);

                    // Process ALL requested tool calls (Supports Parallel Tool Calling)
                    for (const toolCall of responseMessage.tool_calls) {
                        const functionName = toolCall.function.name;
                        let functionArgs = {};
                        
                        try {
                            functionArgs = JSON.parse(toolCall.function.arguments);
                        } catch(err) {
                            console.error("Error parsing function arguments:", err);
                        }

                        console.log(`[AI Tool Call Iteration ${iterations}] Executing: ${functionName}`, functionArgs);

                        const functionToCall = availableFunctions[functionName];
                        const toolResultString = functionToCall ? await functionToCall(functionArgs) : "Error: Function not found";

                        // Push each execution result back to messages array
                        messages.push({
                            role: "tool",
                            tool_call_id: toolCall.id,
                            name: functionName,
                            content: toolResultString
                        });
                    }
                    
                    // Continue the while-loop so Groq can see the results and decide 
                    // whether to run another tool or synthesize the final text!
                } else {
                    // No more tool calls required -> Return final synthesized text
                    return responseMessage.content || "No text content returned from response.";
                }
            }

            return "Error: Exceeded maximum tool execution iterations.";

        } catch (error) {
            console.error("Groq Tool Loop Error:", error);
            return "Error processing request via tool use: " + error.message;
        }
    })

})