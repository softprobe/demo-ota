let searchResults = null;
let searchRequest = null;

// Initialize after page loads
document.addEventListener('DOMContentLoaded', function() {
    // Get search results from sessionStorage
    const resultsData = sessionStorage.getItem('searchResults');
    const requestData = sessionStorage.getItem('searchRequest');
    
    if (!resultsData || !requestData) {
        alert('No search results, please search again');
        window.location.href = '/';
        return;
    }
    
    searchResults = JSON.parse(resultsData);
    searchRequest = JSON.parse(requestData);
    
    // Render page
    renderDateNavigation();
    renderSummaryCards();
    renderFlightList();
    
    // Bind sort event
    document.getElementById('sortSelect').addEventListener('change', function() {
        sortFlights(this.value);
    });
});

// Render date navigation
function renderDateNavigation() {
    const dateNav = document.getElementById('dateNavigation');
    const datePrices = searchResults.summary?.datePrices || [];
    if (!datePrices.length) {
        dateNav.innerHTML = '';
        return;
    }

    dateNav.innerHTML = datePrices.map((datePrice, index) => `
        <div class="col date-item ${datePrice.selected ? 'selected' : ''}" onclick="selectDate(${index})">
            <div class="fw-bold">${datePrice.date}</div>
            <div class="text-muted">HK$${datePrice.minPrice}</div>
        </div>
    `).join('');
    
    // Add flexible date option
    dateNav.innerHTML += `
        <div class="col date-item">
            <div class="fw-bold">Flexible Dates</div>
            <div class="text-muted"><i class="fas fa-calendar-alt"></i></div>
        </div>
    `;
}

// Render summary cards
function renderSummaryCards() {
    const summaryCards = document.getElementById('summaryCards');
    const flights = searchResults.flights;
    
    // Calculate best, cheapest, fastest flights
    const bestFlight = flights[0]; // Assume first is best
    const cheapestFlight = flights.reduce((min, flight) => {
        const minPrice = Math.min(...flight.fareOptions.map(f => f.price));
        const currentMin = Math.min(...min.fareOptions.map(f => f.price));
        return minPrice < currentMin ? flight : min;
    });
    const fastestFlight = flights.reduce((min, flight) => {
        return flight.durationMinutes < min.durationMinutes ? flight : min;
    });
    
    summaryCards.innerHTML = `
        <div class="summary-card best">
            <div class="fw-bold">Best</div>
            <div class="h5">HK$${Math.min(...bestFlight.fareOptions.map(f => f.price))}</div>
            <div class="text-muted">${Math.floor(bestFlight.durationMinutes / 60)}h ${bestFlight.durationMinutes % 60}m</div>
        </div>
        <div class="summary-card">
            <div class="fw-bold">Cheapest</div>
            <div class="h5">HK$${Math.min(...cheapestFlight.fareOptions.map(f => f.price))}</div>
            <div class="text-muted">${Math.floor(cheapestFlight.durationMinutes / 60)}h ${cheapestFlight.durationMinutes % 60}m</div>
        </div>
        <div class="summary-card">
            <div class="fw-bold">Fastest</div>
            <div class="h5">HK$${Math.min(...fastestFlight.fareOptions.map(f => f.price))}</div>
            <div class="text-muted">${Math.floor(fastestFlight.durationMinutes / 60)}h ${fastestFlight.durationMinutes % 60}m</div>
        </div>
    `;
}

// Render flight list
function renderFlightList() {
    const flightList = document.getElementById('flightList');
    const flights = searchResults.flights;
    
    document.getElementById('resultCount').textContent = `${flights.length} results`;
    
    flightList.innerHTML = flights.map((flight, index) => {
        const hasCo2Info = index === 1; // Second flight shows eco info
        
        // Find lowest fare
        const lowestFare = flight.fareOptions.reduce((min, fare) => 
            fare.price < min.price ? fare : min
        );
        
        return `
            <div class="flight-card">
                ${hasCo2Info ? `
                    <div class="co2-info">
                        <i class="fas fa-leaf"></i> ${flight.co2Emission}
                    </div>
                ` : ''}
                
                <div class="row align-items-center">
                    <div class="col-md-8">
                        <div class="d-flex align-items-center mb-3">
                            <div class="airline-logo me-3">
                                ${flight.airlineCode}
                            </div>
                            <div>
                                <div class="fw-bold">${flight.airlineName}</div>
                                <div class="text-muted">${flight.flightNumber}</div>
                            </div>
                            <div class="ms-auto">
                                <i class="fas fa-heart text-muted" style="cursor: pointer;"></i>
                            </div>
                        </div>
                        
                        <div class="flight-route">
                            <div class="flight-time">
                                <div class="h5">${formatTime(flight.departureTime)}</div>
                                <div class="text-muted">${flight.departureAirport}</div>
                            </div>
                            
                            <div class="flight-duration">
                                <div>${Math.floor(flight.durationMinutes / 60)}h ${flight.durationMinutes % 60}m</div>
                                <div class="flight-arrow">
                                    <i class="fas fa-arrow-right"></i>
                                </div>
                                <div class="text-muted">${flight.flightType}</div>
                            </div>
                            
                            <div class="flight-time">
                                <div class="h5">${formatTime(flight.arrivalTime)}</div>
                                <div class="text-muted">${flight.arrivalAirport}</div>
                            </div>
                        </div>
                        
                        <div class="d-flex align-items-center text-muted">
                            ${flight.hasWifi ? '<i class="fas fa-wifi me-2"></i>' : ''}
                            ${flight.hasPowerOutlet ? '<i class="fas fa-plug me-2"></i>' : ''}
                            <span class="me-3">Show details</span>
                        </div>
                    </div>
                    
                    <div class="col-md-4">
                        <div class="fare-option ${lowestFare.isRecommended ? 'recommended' : ''}">
                            <div class="d-flex justify-content-between align-items-start mb-2">
                                <div>
                                    <div class="fw-bold">${lowestFare.providerName}</div>
                                    <div class="rating">
                                        ${'★'.repeat(lowestFare.rating)} <span class="text-muted">(${lowestFare.reviewCount})</span>
                                    </div>
                                    ${lowestFare.isRecommended ? '<span class="badge bg-success">Recommended</span>' : ''}
                                    <div class="text-muted small mt-1">
                                        <i class="fas fa-tag"></i> Lowest price
                                    </div>
                                </div>
                                <div class="text-end">
                                    <div class="h5 mb-0">${lowestFare.currency}${lowestFare.price}</div>
                                    <div class="text-muted small">${flight.fareOptions.length} offers</div>
                                </div>
                            </div>
                            
                            <div class="baggage-info">
                                <div class="baggage-item">
                                    <i class="fas fa-suitcase"></i>
                                    ${lowestFare.baggageInfo.cabinBags} Carry-on Baggage
                                </div>
                                <div class="baggage-item">
                                    <i class="fas fa-suitcase-rolling"></i>
                                    ${lowestFare.baggageInfo.checkedBags >= 0 ? lowestFare.baggageInfo.checkedBags : '?'} Checked Baggage
                                </div>
                            </div>
                            
                            <div class="d-flex justify-content-between align-items-center mt-2">
                                <a href="#" class="text-muted small" onclick="showAllFares('${flight.flightId}')">View all fares</a>
                                <button class="btn btn-select" onclick="selectFlight('${flight.flightId}', '${lowestFare.fareId}')">
                                    Select →
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// Format time
function formatTime(dateTimeString) {
    const date = new Date(dateTimeString);
    return date.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: false 
    });
}

// Select date
function selectDate(index) {
    // Remove all selected states
    document.querySelectorAll('.date-item').forEach(item => {
        item.classList.remove('selected');
    });
    
    // Add selected state
    document.querySelectorAll('.date-item')[index].classList.add('selected');
    
    // Here you can re-search flights for this date
    // For simplicity, we just update the display
}

// Select flight
function selectFlight(flightId, fareId) {
    // Store selected flight information to sessionStorage
    const selectedFlight = searchResults.flights.find(f => f.flightId === flightId);
    const selectedFare = selectedFlight.fareOptions.find(f => f.fareId === fareId);
    
    sessionStorage.setItem('selectedFlight', JSON.stringify({
        flight: selectedFlight,
        fare: selectedFare
    }));
    
    // Navigate to details page
    window.location.href = '/detail.html';
}

// Show all fares
function showAllFares(flightId) {
    const flight = searchResults.flights.find(f => f.flightId === flightId);
    if (!flight) return;
    
    // Create modal to show all fares
    const modal = document.createElement('div');
    modal.className = 'modal fade';
    modal.id = 'faresModal';
    modal.innerHTML = `
        <div class="modal-dialog modal-lg">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title">
                        <i class="fas fa-plane"></i> ${flight.airlineName} ${flight.flightNumber} - All Fares
                    </h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                </div>
                <div class="modal-body">
                    <div class="flight-summary mb-3">
                        <div class="d-flex justify-content-between">
                            <div>
                                <strong>${flight.departureAirport}</strong> → <strong>${flight.arrivalAirport}</strong>
                            </div>
                            <div class="text-muted">
                                ${formatTime(flight.departureTime)} - ${formatTime(flight.arrivalTime)}
                            </div>
                        </div>
                    </div>
                    <div id="allFaresList">
                        ${flight.fareOptions.map(fare => `
                            <div class="fare-option ${fare.isRecommended ? 'recommended' : ''} mb-3">
                                <div class="row align-items-center">
                                    <div class="col-md-8">
                                        <div class="d-flex align-items-center">
                                            <div class="me-3">
                                                <div class="fw-bold">${fare.providerName}</div>
                                                <div class="rating">
                                                    ${'★'.repeat(fare.rating)} <span class="text-muted">(${fare.reviewCount})</span>
                                                </div>
                                                ${fare.isRecommended ? '<span class="badge bg-success">Recommended</span>' : ''}
                                            </div>
                                        </div>
                                        <div class="baggage-info mt-2">
                                            <div class="baggage-item">
                                                <i class="fas fa-suitcase"></i>
                                                ${fare.baggageInfo.cabinBags} Carry-on Baggage
                                            </div>
                                            <div class="baggage-item">
                                                <i class="fas fa-suitcase-rolling"></i>
                                                ${fare.baggageInfo.checkedBags >= 0 ? fare.baggageInfo.checkedBags : '?'} Checked Baggage
                                            </div>
                                        </div>
                                    </div>
                                    <div class="col-md-4 text-end">
                                        <div class="h4 mb-2">${fare.currency}${fare.price}</div>
                                        <button class="btn btn-select" onclick="selectFlight('${flight.flightId}', '${fare.fareId}')">
                                            Select →
                                        </button>
                                    </div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    const bootstrapModal = new bootstrap.Modal(modal);
    bootstrapModal.show();
    
    // Remove element after modal closes
    modal.addEventListener('hidden.bs.modal', function() {
        document.body.removeChild(modal);
    });
}

// Sort flights
function sortFlights(sortBy) {
    const flights = [...searchResults.flights];
    
    switch (sortBy) {
        case 'price':
            flights.sort((a, b) => {
                const minPriceA = Math.min(...a.fareOptions.map(f => f.price));
                const minPriceB = Math.min(...b.fareOptions.map(f => f.price));
                return minPriceA - minPriceB;
            });
            break;
        case 'duration':
            flights.sort((a, b) => a.durationMinutes - b.durationMinutes);
            break;
        case 'departure':
            flights.sort((a, b) => new Date(a.departureTime) - new Date(b.departureTime));
            break;
        default: // best
            // Keep original order
            break;
    }
    
    searchResults.flights = flights;
    renderFlightList();
} 