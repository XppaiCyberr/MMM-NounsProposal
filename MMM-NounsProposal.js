/* MMM-NounsProposal.js */
Module.register("MMM-NounsProposal", {
    defaults: {
        updateInterval: 300000, // 5 minutes
        showRawData: false,
        header: "Recent Nouns Proposals",
        maxProposals: 15, // Total number of proposals to fetch
        proposalsPerPage: 5, // Number of proposals per page
        cycleInterval: 10000, // Time between page changes (5 seconds)
        animationSpeed: 2000, // Animation speed for transitions
        minProposalsPerPage: 2, // Minimum proposals per page to enable cycling
        showProposer: true // Whether to show proposer info
    },

    requiresVersion: "2.1.0",

    start: function() {
        Log.info("Starting module: " + this.name);
        this.proposalData = null;
        this.loaded = false;
        this.error = null;
        this.currentPage = 0;
        this.cycleTimer = null;
        this.scheduleUpdate();
    },

    getDom: function() {
        const wrapper = document.createElement("div");
        wrapper.className = "nouns-proposal";

        // Add header
        const header = document.createElement("header");
        header.className = "module-header";
        header.textContent = this.config.header;
        wrapper.appendChild(header);

        // If we're still loading
        if (!this.loaded) {
            const loading = document.createElement("div");
            loading.className = "dimmed light";
            loading.innerHTML = this.translate("LOADING");
            wrapper.appendChild(loading);
            return wrapper;
        }

        // If we have an error
        if (this.error) {
            const errorMessage = document.createElement("div");
            errorMessage.className = "error-message";
            errorMessage.textContent = this.error;
            wrapper.appendChild(errorMessage);
            return wrapper;
        }

        // If we have data
        if (this.proposalData && Array.isArray(this.proposalData)) {
            Log.debug(`${this.name}: Rendering proposals. Total count: ${this.proposalData.length}, Current page: ${this.currentPage + 1}`);
            
            const content = document.createElement("div");
            content.className = "proposal-content";

            // Use effective page size if it was calculated, otherwise use config value
            const proposalsPerPage = this.effectivePageSize || this.config.proposalsPerPage;
            
            // Calculate page boundaries
            const pageCount = Math.ceil(this.proposalData.length / proposalsPerPage);
            const startIndex = this.currentPage * proposalsPerPage;
            const endIndex = Math.min(startIndex + proposalsPerPage, this.proposalData.length);
            
            Log.debug(`${this.name}: Page calculations: pageCount=${pageCount}, startIndex=${startIndex}, endIndex=${endIndex}, proposalsPerPage=${proposalsPerPage}`);

            // Display current page of proposals
            this.proposalData.slice(startIndex, endIndex).forEach(proposal => {
                const proposalContainer = document.createElement("div");
                proposalContainer.className = "proposal-container";

                // Add header with ID, proposer and status
                const headerInfo = document.createElement("div");
                headerInfo.className = "proposal-header";
                
                // Create the ID span
                const idSpan = document.createElement("span");
                idSpan.className = "prop-id";
                
                // Add proposer info if configured and available
                if (this.config.showProposer && proposal.proposerDisplay) {
                    idSpan.textContent = `Prop ${proposal.proposalId} | ${proposal.proposerDisplay}`;
                } else {
                    idSpan.textContent = `Prop ${proposal.proposalId}`;
                }
                
                const statusSpan = document.createElement("span");
                statusSpan.className = `status-badge ${proposal.status.currentStatus.toLowerCase()}`;
                statusSpan.textContent = proposal.status.currentStatus;
                
                headerInfo.appendChild(idSpan);
                headerInfo.appendChild(statusSpan);
                proposalContainer.appendChild(headerInfo);

                // Add title
                const titleInfo = document.createElement("div");
                titleInfo.className = "proposal-title";
                titleInfo.textContent = proposal.title;
                proposalContainer.appendChild(titleInfo);

                // Create vote progress bar container
                const progressContainer = document.createElement("div");
                progressContainer.className = "vote-progress-container";

                // Calculate total votes and percentages
                const totalVotes = proposal.forVotes + proposal.againstVotes + proposal.abstainVotes;
                const forPercent = totalVotes > 0 ? (proposal.forVotes / totalVotes) * 100 : 0;
                const againstPercent = totalVotes > 0 ? (proposal.againstVotes / totalVotes) * 100 : 0;
                const abstainPercent = totalVotes > 0 ? (proposal.abstainVotes / totalVotes) * 100 : 0;

                // Create vote summary text
                const voteSummary = document.createElement("div");
                voteSummary.className = "vote-summary";
                voteSummary.innerHTML = `For ${proposal.forVotes} · Abstain ${proposal.abstainVotes} · Against ${proposal.againstVotes}`;
                
                // Create progress bar
                const progressBar = document.createElement("div");
                progressBar.className = "vote-progress-bar";

                // Add segments for each vote type
                const forSegment = document.createElement("div");
                forSegment.className = "vote-segment for";
                forSegment.style.width = `${forPercent}%`;

                const abstainSegment = document.createElement("div");
                abstainSegment.className = "vote-segment abstain";
                abstainSegment.style.width = `${abstainPercent}%`;

                const againstSegment = document.createElement("div");
                againstSegment.className = "vote-segment against";
                againstSegment.style.width = `${againstPercent}%`;

                // Add quorum indicator if available
                if (proposal.quorumVotes) {
                    const quorumPercent = (proposal.quorumVotes / totalVotes) * 100;
                    const quorumIndicator = document.createElement("div");
                    quorumIndicator.className = "quorum-indicator";
                    quorumIndicator.style.left = `${quorumPercent}%`;
                    progressBar.appendChild(quorumIndicator);
                }

                progressBar.appendChild(forSegment);
                progressBar.appendChild(abstainSegment);
                progressBar.appendChild(againstSegment);

                progressContainer.appendChild(voteSummary);
                progressContainer.appendChild(progressBar);
                proposalContainer.appendChild(progressContainer);

                content.appendChild(proposalContainer);
            });

            wrapper.appendChild(content);

            // Add pagination indicator if there are multiple pages
            if (pageCount > 1) {
                const paginationDiv = document.createElement("div");
                paginationDiv.className = "pagination";
                paginationDiv.innerHTML = `Page ${this.currentPage + 1}/${pageCount}`;
                wrapper.appendChild(paginationDiv);
            }
        }

        return wrapper;
    },

    getStyles: function() {
        return [
            "MMM-NounsProposal.css",
        ];
    },

    scheduleUpdate: function() {
        const self = this;
        
        // Initial fetch
        self.fetchProposalData();
        
        // Schedule data updates
        setInterval(function() {
            self.fetchProposalData();
        }, this.config.updateInterval);
    },
    
    cyclePagination: function() {
        const self = this;
        
        // Clear any existing timer
        if (this.cycleTimer) {
            clearInterval(this.cycleTimer);
            this.cycleTimer = null;
        }
        
        // If we have proposals data
        if (this.proposalData && Array.isArray(this.proposalData) && this.proposalData.length > 0) {
            Log.info(`${this.name}: Starting page cycling for ${this.proposalData.length} proposals`);
            
            // Determine the best page size based on available data
            let effectivePageSize = this.config.proposalsPerPage;
            
            // If we have fewer proposals than would make two full pages, adjust page size
            if (this.proposalData.length < this.config.proposalsPerPage * 2 && 
                this.proposalData.length > this.config.minProposalsPerPage) {
                // Calculate a new smaller page size to enable cycling
                effectivePageSize = Math.floor(this.proposalData.length / 2);
                if (effectivePageSize < this.config.minProposalsPerPage) {
                    effectivePageSize = this.config.minProposalsPerPage;
                }
                Log.info(`${this.name}: Adjusted page size to ${effectivePageSize} for better cycling`);
            }
            
            // Calculate how many pages we'll have with the effective page size
            const pageCount = Math.ceil(this.proposalData.length / effectivePageSize);
            
            // Store the effective page size for use in getDom
            this.effectivePageSize = effectivePageSize;
            
            // Only set up cycling if we can have multiple pages
            if (pageCount > 1) {
                // Set up interval for cycling pages
                this.cycleTimer = setInterval(function() {
                    // Move to next page, wrapping around to beginning after last page
                    self.currentPage = (self.currentPage + 1) % pageCount;
                    Log.debug(`${self.name}: Cycling to page ${self.currentPage + 1}/${pageCount}`);
                    self.updateDom(self.config.animationSpeed);
                }, this.config.cycleInterval);
            } else {
                Log.info(`${this.name}: Not enough proposals for cycling with adjusted page size, staying on page 1`);
            }
        } else {
            Log.info(`${this.name}: No proposals available for cycling`);
        }
    },

    fetchProposalData: function() {
        this.sendSocketNotification("FETCH_PROPOSAL_DATA", {
            maxProposals: this.config.maxProposals
        });
    },

    socketNotificationReceived: function(notification, payload) {
        if (notification === "PROPOSAL_DATA_RESULT") {
            if (payload.error) {
                this.error = payload.error;
                Log.error(`${this.name}: Error receiving data: ${payload.error}`);
            } else {
                Log.info(`${this.name}: Received ${payload.data.length} proposals`);
                this.proposalData = payload.data;
                this.error = null;
                
                // Reset to first page when new data arrives
                this.currentPage = 0;
                
                // Start/restart cycling timer with new data
                this.cyclePagination();
            }
            
            this.loaded = true;
            this.updateDom(this.config.animationSpeed);
        }
    }
});
