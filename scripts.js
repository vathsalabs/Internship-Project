const socket = io("http://localhost:5000");

document.addEventListener("DOMContentLoaded", function () {
    const tableHead = document.getElementById("table-header");
    const tableBody = document.getElementById("table-body");
    const owningGroupDropdown = document.getElementById("owningGroup");
    const sortByDropdown = document.getElementById("sortBy");
    const currentStateDropdown = document.getElementById("currentState");
    const serviceNameDropdown = document.getElementById("serviceName");

    const hiddenColumns = ["uid", "taskID"];
    let configData = [];
    let taskData = [];

    function fetchConfig() {
        fetch('config.json?t=' + new Date().getTime())
            .then(response => response.json())
            .then(config => {
                if (config?.headers) {
                    configData = config.headers.filter(header => !hiddenColumns.includes(header.key));
                    renderTableHeaders(configData);
                }
            })
            .catch(error => console.error("Error fetching config:", error));
    }

    function renderTableHeaders(headers) {
        tableHead.innerHTML = "";
        headers.forEach(header => {
            const th = document.createElement("th");
            th.textContent = header.label;
            tableHead.appendChild(th);
        });
    }

    function getRowColor(timeDifference, currentState) {
        const hours = parseFloat(timeDifference) || 0;

        if (currentState.toLowerCase() === "complete") {
            return "green";
        } else if (hours > 8) {
            return "red";
        } else if (hours > 4 && hours <= 8) {
            return "orange";
        }
        return "";
    }

 
    function populateDropdown(data) {
        populateSpecificDropdown(owningGroupDropdown, new Set(data.map(item => item.owning_group)));
        populateSpecificDropdown(currentStateDropdown, new Set(data.map(item => item.currentState)));
        populateSpecificDropdown(serviceNameDropdown, new Set(data.map(item => item.serviceName)));
    }

    function populateSpecificDropdown(dropdown, values) {
        dropdown.innerHTML = '<option value="all">All</option>';
        values.forEach(value => {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = value;
            dropdown.appendChild(option);
        });
    }

    function populateTable(data) {
        tableBody.innerHTML = "";

        const filteredData = filterByGroup(data);
        const sortedData = sortByField(filteredData);

        sortedData.forEach(item => {
            const row = document.createElement("tr");
            let rowHTML = "";

            const rowColor = getRowColor(item.time_difference, item.currentState);

            configData.forEach(header => {
                if (header.key === "select") {
                    rowHTML += `<td><input type="checkbox" name="rowSelect" data-uid="${item.uid}"></td>`;
                } else {
                    const cellValue = item[header.key] || "N/A";
                    if (header.key === "time_difference" && rowColor) {
                        rowHTML += `<td style="color: ${rowColor}; font-weight: bold;">${cellValue}</td>`;
                    } else if (header.key === "currentState" && item.currentState.toLowerCase() === "complete") {
                        rowHTML += `<td style="color: green; font-weight: bold;">${cellValue}</td>`;
                    } else {
                        rowHTML += `<td>${cellValue}</td>`;
                    }
                }
            });

            row.innerHTML = rowHTML;
            tableBody.appendChild(row);
        });
    }

    
    function filterByGroup(data) {
        const selectedGroup = owningGroupDropdown.value;
        const selectedState = currentStateDropdown.value;
        const selectedService = serviceNameDropdown.value;

        return data.filter(item => {
            const groupMatch = selectedGroup === "all" || item.owning_group === selectedGroup;
            const stateMatch = selectedState === "all" || item.currentState === selectedState;
            const serviceMatch = selectedService === "all" || item.serviceName === selectedService;

            return groupMatch && stateMatch && serviceMatch;
        });
    }

    function sortByField(data) {
        const sortBy = sortByDropdown.value;
        return data.sort((a, b) => {
            if (sortBy === "creation_date") {
                return new Date(b.creation_date) - new Date(a.creation_date);
            } else if (sortBy === "time_difference") {
                return b.time_hours - a.time_hours;
            }
            return 0;
        });
    }

    function getSelectedTaskUids() {
        return Array.from(document.querySelectorAll("input[name='rowSelect']:checked"))
            .map(checkbox => checkbox.dataset.uid);
    }

    function sendPostRequest(action, taskUids) {
        fetch(`http://localhost:5000/api/${action}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ taskIds: taskUids }),
        })
            .then(response => response.json())
            .then(data => alert(`${action} successful`))
            .catch(error => console.error(`${action} error:`, error));
    }

    ["resubmit", "recreate", "delete"].forEach(action => {
        document.getElementById(action).addEventListener("click", () => {
            const taskUids = getSelectedTaskUids();
            if (taskUids.length) sendPostRequest(action, taskUids);
            else alert(`Select at least one task to ${action}.`);
        });
    });

    document.getElementById("refresh").addEventListener("click", () => {
        fetch("http://localhost:5000/api/refresh", { method: "POST" });
        alert("Dashboard refreshed");
    });

    // Attach change event listeners to update table on filter change
    [owningGroupDropdown, currentStateDropdown, serviceNameDropdown, sortByDropdown].forEach(dropdown => {
        dropdown.addEventListener("change", () => populateTable(taskData));
    });

    fetchConfig();

    socket.on("updateData", (data) => {
        taskData = data;
        populateDropdown(data);
        populateTable(data);
    });
});
