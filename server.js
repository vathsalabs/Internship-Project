const express = require("express");
const axios = require("axios");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const https = require("https");
const nodemailer = require("nodemailer");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());

const API_URL = "https://globalplm.intevaproducts.com:8020/dispatcherservice/rest/info?site=PILOT";
const ACTION_URL = "https://globalplm.intevaproducts.com:8020/dispatcherservice/rest/action";

const agent = new https.Agent({ rejectUnauthorized: false });

const getTimeDifference = (creationDate) => {
    if (!creationDate) return { formatted: "N/A", hours: 0 };

    const createdAt = new Date(creationDate);
    const now = new Date();
    const diffMs = now - createdAt;

    if (isNaN(diffMs)) return { formatted: "Invalid Date", hours: 0 };

    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diffMs % (1000 * 60)) / 1000);

    return { formatted: `${hours} hrs ${minutes} min ${seconds} sec`, hours };
};

let currentData = [];
let notifiedTasks = new Set(); 

const transporter = nodemailer.createTransport({
    host: "smtp.office365.com",
    port: 587,
    secure: false,
    auth: {
        user: "vsampathkumar@intevaproducts.com",
        pass: "Growth@2025",
    },
    tls: {
        minVersion: "TLSv1.2",
    },
});

const createTaskTable = (tasks) => {
    return `
    <h2 style="color: red;">Pending Dispatcher Tasks Alert </h2>
    <table border="1" cellpadding="8" cellspacing="0" style="border-collapse: collapse; width: 100%;">
        <thead>
            <tr style="background-color: #f2f2f2;">
                <th>Task ID</th>
                <th>Part Number</th>
                <th>Owning Group</th>
                <th>Service Name</th>
                <th>Current State</th>
                <th>Time Difference</th>

            </tr>
        </thead>
        <tbody>
            ${tasks.map(task => `
                <tr>
                    <td>${task.uid}</td>
                    <td>${task.primaryObjects}</td>
                    <td>${task.owning_group}</td>
                    <td>${task.serviceName}</td>
                    <td>${task.currentState}</td>
                    <td>${task.time_difference}</td>
                </tr>
            `).join("")}
        </tbody>
    </table>
    <p>Please address these tasks immediately to avoid disruptions.</p>
    `;
};

const sendBatchEmail = async (tasks, ccAdmin = false) => {
    const mailOptions = {
        from: "vsampathkumar@intevaproducts.com",
        to: "vsampathkumar@intevaproducts.com",
        //to: "rshetty@intevaproducts.com",
        subject: "Urgent: Pending Dispatcher Tasks Alert",
        html: createTaskTable(tasks),
        cc: ccAdmin ? "rshetty@intevaproducts.com" : undefined,
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`Batch email sent successfully with ${tasks.length} tasks.`);
    } catch (error) {
        console.error("Error sending batch email:", error.message);
    }
};

const fetchData = async () => {
    try {
        const response = await axios.get(API_URL, { httpsAgent: agent });
        currentData = response.data.map(item => {
            const timeDiff = getTimeDifference(item.creation_date);
            return { ...item, time_difference: timeDiff.formatted, time_hours: timeDiff.hours };
        });

        io.emit("updateData", currentData);
        checkAndSendEmails(); 
    } catch (error) {
        console.error("Error fetching data:", error.message);
    }
};

const checkAndSendEmails = () => {
    const overdueTasks = currentData.filter(task => task.time_hours > 6 && task.currentState !== "COMPLETE");

   
    const newOverdueTasks = overdueTasks.filter(task => !notifiedTasks.has(task.uid));

    if (newOverdueTasks.length > 0) {
        
        sendBatchEmail(newOverdueTasks);
        
        // Track the sent tasks
        newOverdueTasks.forEach(task => notifiedTasks.add(task.uid));

        
        setTimeout(() => sendBatchEmail(newOverdueTasks), 30 * 60 * 1000); 
        setTimeout(() => sendBatchEmail(newOverdueTasks, true), 60 * 60 * 1000); // After 1 hour with admin in CC
    }

    
    currentData.forEach(task => {
        if (task.currentState === "COMPLETE") {
            notifiedTasks.delete(task.uid);
        }
    });
};

io.on("connection", (socket) => {
    console.log("Client connected");
    if (currentData.length === 0) fetchData(); 
    socket.emit("updateData", currentData); 
});

const handlePostAction = (action) => {
    app.post(`/api/${action}`, async (req, res) => {
        const { taskIds } = req.body;

        if (!taskIds || !Array.isArray(taskIds) || taskIds.length === 0) {
            return res.status(400).json({ error: "Invalid or empty taskIds array" });
        }

        try {
            const payload = {
                uids: taskIds,
                action: action,
                site: "PILOT",
            };

            const response = await axios.post(ACTION_URL, payload, { httpsAgent: agent });

            const matchedItems = currentData.filter(item => taskIds.includes(item.uid));
            
            const uids = taskIds.join(", ");
            const partNumbers = matchedItems.map(item => item.primaryObjects || "N/A").join(", ");

            console.log(`✅ Action: ${action.toUpperCase()} | UIDs: ${uids} | Part Number: ${partNumbers} | Status: ${response.status} - OK`);
            res.status(200).json({ message: `${action} successful`, data: response.data });

            fetchData(); // Refresh data after action
        } catch (error) {
            console.error(`❌ Error in ${action.toUpperCase()} | UIDs: ${taskIds.join(", ")} | Part Number: ${partNumbers} | Status: ${error.response?.status || "Unknown"}`);
            res.status(400).json({ error: `Failed to ${action}` });
        }
    });
};

["resubmit", "recreate", "delete"].forEach(handlePostAction);

app.post("/api/refresh", async (req, res) => {
    try {
        await fetchData();
        console.log("Data refreshed successfully");
        res.status(200).json({ message: "Data refreshed successfully" });
    } catch (error) {
        console.error("❌ Error refreshing data:", error.message);
        res.status(500).json({ error: "Failed to refresh data" });
    }
});

server.listen(5000, () => {
    console.log("🚀 Server running on port 5000");
});
