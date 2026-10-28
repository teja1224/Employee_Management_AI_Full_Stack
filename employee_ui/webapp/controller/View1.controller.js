sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/ui/core/Fragment",
    "sap/m/MessageBox",
], (Controller, JSONModel, MessageToast, Fragment, MessageBox) => {
    "use strict";

    return Controller.extend("employeebot.employeeui.controller.View1", {
        onInit() {
            var oChatModel = new JSONModel({
                messages: [
                    {
                        sender: "AI Assistant",
                        text: "Hello! I am connected to your live SAP HANA Cloud database. Ask me anything about employees, departments, or projects.",
                        formattedText: "Hello! I am connected to your live <b>SAP HANA Cloud</b> database. Ask me anything about employees, departments, or projects.",
                        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    }
                ],
                test:[
                    {
                        name:"teja"
                    }
                ]
            });
            this.getView().setModel(oChatModel, "chatModel");

            // Attach keydown interceptor to FeedInput textarea once rendered
            var that = this;
            this.getView().byId("chatFeedInput").addEventDelegate({
                onAfterRendering: function () {
                    var oFeedInput = that.getView().byId("chatFeedInput");
                    if (oFeedInput && oFeedInput.getDomRef()) {
                        var oTextArea = oFeedInput.getDomRef().querySelector("textarea");
                        
                        if (oTextArea && !oTextArea.dataset.enterBound) {
                            oTextArea.dataset.enterBound = "true"; // Prevent duplicate event listeners
                            
                            oTextArea.addEventListener("keydown", function (oKeyEvt) {
                                // If Enter is pressed without Shift
                                if (oKeyEvt.key === "Enter" && !oKeyEvt.shiftKey) {
                                    oKeyEvt.preventDefault(); // Prevent adding newline
                                    var sValue = oFeedInput.getValue();
                                    if (sValue && sValue.trim().length > 0) {
                                        oFeedInput.firePost({ value: sValue }); // Trigger post action
                                        oFeedInput.setValue(""); // Clear input box
                                    }
                                }
                            });
                        }
                    }
                }
            });
        },

        onRefreshData: function () {
            var oModel = this.getView().getModel();
            if (oModel) {
                oModel.refresh();
                MessageToast.show("Data refreshed from SAP HANA Cloud.");
            }
        },
        // Helper function to scroll chat container to bottom
        _scrollToBottom: function () {
            var oScrollContainer = this.getView().byId("chatScrollContainer");
            if (oScrollContainer) {
                setTimeout(function () {
                    var oDomRef = oScrollContainer.getDomRef();
                    if (oDomRef) {
                        oScrollContainer.scrollTo(0, oDomRef.scrollHeight, 300);
                    }
                }, 100);
            }
        },

        //Add new employee
        onOpenAddDialog: function(){
            var oView = this.getView()
            // Initialize local JSON model with fields for all properties
            var oNewEmployeeModel = new JSONModel({
                name: "",
                email: "",
                role: "",
                salary: "",
                department_ID: "",
                selectedProjectIDs: [] // Array of selected project UUIDs from MultiComboBox
            });

            oView.setModel(oNewEmployeeModel, "newEmployee");

            // Load and open fragment if not already created
            if (!this.byId("addEmployeeDialog")) {
                Fragment.load({
                    id: oView.getId(),
                    name: "employeebot.employeeui.view.AddEmployee",
                    controller: this
                }).then(function (oDialog){
                    oView.addDependent(oDialog);
                    oDialog.open();
                }.bind(this));
            }else{
                this.byId("addEmployeeDialog").open();
            }
        },

        // 3. Close/Cancel the dialog
        onCancelDialog: function () {
            var oDialog = this.byId("addEmployeeDialog");
            if (oDialog) {
                oDialog.close();
            }
        },

        onSaveEmployee: function () {
            var oView = this.getView();
            var oDataModel = oView.getModel();
            var oLocalModel = oView.getModel("newEmployee");
            var oFormData = oLocalModel.getData();

            // Validation check
            if (!oFormData.name || !oFormData.email || !oFormData.role) {
                MessageToast.show("Please fill in all required fields");
                return;
            }
            // 1. Build the base payload matching your CDS entity
            var oPayload = {
                name: oFormData.name,
                email: oFormData.email,
                role: oFormData.role,
                salary: oFormData.salary ? parseFloat(oFormData.salary) : 0
            };
            // 2. Handle Department Association (Many-to-One)
            if (oFormData.department_ID) {
                oPayload.department_ID = oFormData.department_ID;
            }
            // 3. Handle Projects Association (Many-to-Many via EmployeeProjects)
            // CAP supports deep insert for composition/associations using nested objects
            if(oFormData.selectedProjectIDs && oFormData.selectedProjectIDs.length > 0){
                oPayload.projects = oFormData.selectedProjectIDs.map((sProjectID)=> {
                    return {
                        project: { ID: sProjectID }
                    }
                })
            }

            var oListBinding = oDataModel.bindList("/Employees");
            try{
                // Trigger POST request with deep payload
                var oContext = oListBinding.create(oPayload);
                oContext.created().then( ()=>{
                    MessageToast.show("Employee and associations created successfully!");
                    this.onCancelDialog();
                }).catch( (oError)=>{
                    MessageBox.error("Failed to create employee: " + (oError.message || oError));
                });
            }
            catch(oError){
                MessageBox.error("Error: " + oError.message);
            }
        },

        onSendChatPrompt: function (oEvent) {
            var sPrompt = oEvent.getParameter("value");
            if (!sPrompt || sPrompt.trim() === "") return;

            var oChatModel = this.getView().getModel("chatModel");
            var aMessages = oChatModel.getProperty("/messages");
            var sTimeString = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            // 1. Append User Message
            aMessages.push({
                sender: "You",
                text: sPrompt,
                formattedText: this._escapeHtml(sPrompt),
                time: sTimeString
            });
            oChatModel.setProperty("/messages", aMessages);
            
            // 2. Add temporary "Thinking..." placeholder
            var iLoadingIndex = aMessages.push({
                sender: "AI Assistant",
                text: "Thinking...",
                formattedText: "<i>Thinking...</i>",
                time: sTimeString
            }) - 1;
            oChatModel.setProperty("/messages", aMessages);
            // 3. Invoke CAP OData V4 Unbound Action (/askGroqBot)
            var oModel = this.getView().getModel();
            var oContext = oModel.bindContext("/askGroqBot2(...)");
            oContext.setParameter("prompt", sPrompt);
            // Send the message array as a JSON string so Groq remembers past conversation turns
            oContext.setParameter("history", JSON.stringify(aMessages));
            
            var that = this;
            oContext.execute().then(function () {
                var sResult = oContext.getBoundContext().getValue();

                // Update placeholder with actual AI answer
                aMessages[iLoadingIndex].text = sResult.value;
                aMessages[iLoadingIndex].formattedText = that._formatMarkdownToHtml(sResult.value);
                aMessages[iLoadingIndex].time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                oChatModel.setProperty("/messages", aMessages);
                that._scrollToBottom()

            }).catch(function (oError) {
                console.error("CAP Service Action Error:", oError);
                aMessages[iLoadingIndex].text = "Error communicating with CAP service.";
                aMessages[iLoadingIndex].formattedText = "<span style='color:red;'>Failed to retrieve response from CAP backend.</span>";
                oChatModel.setProperty("/messages", aMessages);
                that._scrollToBottom()
            });
        },

        _formatMarkdownToHtml: function (sText) {
            if (!sText) return "";

            var sFormatted = sText;

            // 1. Convert markdown bold **text** to <b>text</b>
            sFormatted = sFormatted.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');

            // 2. Convert markdown bullet points (* item or - item) to <li>
            sFormatted = sFormatted.replace(/^[\*\-]\s+(.*)$/gm, '<li>$1</li>');

            // 3. Convert double newlines into paragraph breaks, single newlines to <br/>
            sFormatted = sFormatted.replace(/\n\n/g, '<br/><br/>');
            sFormatted = sFormatted.replace(/\n/g, '<br/>');

            // 4. Wrap orphaned <li> tags in a styled <ul> container if the LLM didn't include <ul>
            if (sFormatted.includes('<li>') && !sFormatted.includes('<ul>')) {
                sFormatted = sFormatted.replace(/(<li>.*?<\/li>)/gs, '<ul style="padding-left:1.2rem; margin:0.5rem 0;">$1</ul>');
            }

            return sFormatted;
        },
        _escapeHtml: function (sStr) {
            return String(sStr).replace(/&/g, '&amp;')
                              .replace(/</g, '&lt;')
                              .replace(/>/g, '&gt;')
                              .replace(/"/g, '&quot;');
        }
    });
});