let bookingResult = null;
let selectedPaymentMethod = null;

// Initialize after page loads
document.addEventListener('DOMContentLoaded', function() {
    // Get booking result from sessionStorage
    const bookingData = sessionStorage.getItem('bookingResult');
    
    if (!bookingData) {
        alert('No booking information, please book again');
        window.location.href = '/booking.html';
        return;
    }
    
    bookingResult = JSON.parse(bookingData);
    
    // Debug: Log the booking result to console
    console.log('Booking Result:', bookingResult);
    console.log('Payment Info:', bookingResult.paymentInfo);
    
    // Render page
    renderFlightInfo();
    renderPriceSummary();
});

// Render flight information
function renderFlightInfo() {
    const flightInfo = document.getElementById('flightInfo');
    
    // Check if flight info exists
    if (!bookingResult.flightInfo) {
        console.error('Flight info missing:', bookingResult);
        flightInfo.innerHTML = `
            <div class="alert alert-warning">
                <i class="fas fa-exclamation-triangle"></i>
                Flight information is not available. Please contact support.
            </div>
        `;
        return;
    }
    
    const flight = bookingResult.flightInfo;
    
    flightInfo.innerHTML = `
        <div class="d-flex justify-content-between align-items-center mb-3">
            <div>
                <div class="fw-bold">${flight.flightNumber}</div>
                <div class="text-muted">${flight.cabinClass}</div>
            </div>
            <div class="text-end">
                <div class="h5 mb-0">PNR: ${bookingResult.confirmationNumber}</div>
                <div class="text-muted">Booking Reference</div>
            </div>
        </div>
        
        <div class="flight-route">
            <div class="flight-time">
                <div class="h5">${formatTime(flight.departureTime)}</div>
                <div class="text-muted">${flight.departureAirport}</div>
                <div class="text-muted">${flight.departureCity}</div>
            </div>
            
            <div class="flight-duration">
                <div class="fw-bold">${Math.floor(getDurationMinutes(flight.departureTime, flight.arrivalTime) / 60)}h ${getDurationMinutes(flight.departureTime, flight.arrivalTime) % 60}m</div>
                <div class="flight-arrow">
                    <i class="fas fa-arrow-right"></i>
                </div>
                <div class="text-muted">Direct</div>
            </div>
            
            <div class="flight-time">
                <div class="h5">${formatTime(flight.arrivalTime)}</div>
                <div class="text-muted">${flight.arrivalAirport}</div>
                <div class="text-muted">${flight.arrivalCity}</div>
            </div>
        </div>
        
        <div class="border-top pt-3">
            <div class="text-muted">
                Departure Date: ${formatDate(flight.departureTime)}
            </div>
        </div>
    `;
}

// Render price summary
function renderPriceSummary() {
    const priceSummary = document.getElementById('priceSummary');
    
    // Check if payment info exists and has the required fields
    if (!bookingResult.paymentInfo || !bookingResult.paymentInfo.amount || !bookingResult.paymentInfo.currency) {
        console.error('Payment info missing or incomplete:', bookingResult.paymentInfo);
        priceSummary.innerHTML = `
            <div class="alert alert-warning">
                <i class="fas fa-exclamation-triangle"></i>
                Price information is not available. Please contact support.
            </div>
        `;
        return;
    }
    
    const currency = bookingResult.paymentInfo.currency || 'USD';
    const amount = bookingResult.paymentInfo.amount || 0;
    
    priceSummary.innerHTML = `
        <div class="row mb-3">
            <div class="col-6">Flight Fee</div>
            <div class="col-6 text-end">${currency}${amount}</div>
        </div>
        <div class="row mb-3">
            <div class="col-6">Taxes</div>
            <div class="col-6 text-end">${currency}0</div>
        </div>
        <div class="row mb-3">
            <div class="col-6">Service Fee</div>
            <div class="col-6 text-end">${currency}0</div>
        </div>
        <hr>
        <div class="row">
            <div class="col-6 h5 mb-0">Total</div>
            <div class="col-6 text-end h5 mb-0">${currency}${amount}</div>
        </div>
    `;
}

// Select payment method
function selectPaymentMethod(method) {
    selectedPaymentMethod = method;
    
    // Remove all selected states
    document.querySelectorAll('.payment-method').forEach(item => {
        item.classList.remove('selected');
    });
    
    // Add selected state
    event.currentTarget.classList.add('selected');
    
    // Show/hide credit card form
    const creditCardForm = document.getElementById('creditCardForm');
    if (method === 'CREDIT_CARD') {
        creditCardForm.style.display = 'block';
    } else {
        creditCardForm.style.display = 'none';
    }
}

// Process payment
async function processPayment() {
    console.log('processPayment function called');
    
    if (!selectedPaymentMethod) {
        alert('Please select a payment method');
        return;
    }
    
    if (selectedPaymentMethod === 'CREDIT_CARD') {
        // Validate credit card information
        const cardHolderName = document.getElementById('cardHolderName').value;
        const cardNumber = document.getElementById('cardNumber').value;
        const cardExpiry = document.getElementById('cardExpiry').value;
        const cardCvv = document.getElementById('cardCvv').value;
        
        if (!cardHolderName || !cardNumber || !cardExpiry || !cardCvv) {
            alert('Please fill in complete credit card information');
            return;
        }
    }
    
    // Show loading state
    const payButton = document.querySelector('.btn-pay');
    const originalText = payButton.innerHTML;
    payButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
    payButton.disabled = true;
    
    try {
        const paymentData = {
            bookingId: bookingResult.bookingId,
            paymentMethod: selectedPaymentMethod,
            amount: Number(bookingResult.paymentInfo.amount).toFixed(2),
            currency: bookingResult.paymentInfo.currency,
            paymentDetails: selectedPaymentMethod === 'CREDIT_CARD' ? {
                cardNumber: document.getElementById('cardNumber').value,
                cardHolderName: document.getElementById('cardHolderName').value,
                expiryDate: document.getElementById('cardExpiry').value,
                cvv: document.getElementById('cardCvv').value,
                billingAddress: document.getElementById('billingAddress').value
            } : {}
        };
        
        console.log('Sending payment data:', paymentData);
        
        const response = await fetch('/api/flights/payandissue', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-sp-session-id': getSessionId()
            },
            body: JSON.stringify(paymentData)
        });
        
        if (response.ok) {
            let result;
            try {
                result = await response.json();
                console.log('Payment API response received:', result);
                console.log('Response status:', response.status);
                console.log('Response headers:', Object.fromEntries(response.headers.entries()));
            } catch (jsonError) {
                console.error('Failed to parse JSON response:', jsonError);
                const responseText = await response.text();
                console.error('Raw response text:', responseText);
                alert('Payment completed but response format is invalid. Please contact support.');
                return;
            }
            
            if (result && result.status === 'SUCCESS') {
                console.log('Payment successful, calling showPaymentSuccess');
                showPaymentSuccess(result);
            } else {
                console.error('Payment API returned success but with unexpected status:', result);
                alert('Payment completed but with unexpected status. Please contact support.');
            }
        } else {
            const errorText = await response.text();
            console.error('Payment failed with status:', response.status);
            console.error('Error response:', errorText);
            alert(`Payment failed with status ${response.status}. Check console for details.`);
        }
    } catch (error) {
        console.error('Payment error:', error);
        alert('Payment failed, please check network connection');
    } finally {
        // Restore button state
        payButton.innerHTML = originalText;
        payButton.disabled = false;
    }
}

// Show payment success
function showPaymentSuccess(paymentResult) {
    try {
        console.log('Processing payment success with result:', paymentResult);
        
        // Validate required fields
        if (!paymentResult || !paymentResult.status) {
            console.error('Invalid payment result:', paymentResult);
            alert('Payment result is invalid. Please contact support.');
            return;
        }
        
        // Hide payment form area
        document.getElementById('paymentFormArea').style.display = 'none';
        
        // Show success area
        const successArea = document.getElementById('successArea');
        successArea.style.display = 'block';
        
        // Render payment details
        const ticketDetails = document.getElementById('ticketDetails');
        ticketDetails.innerHTML = `
            <div class="row">
                <div class="col-md-6">
                    <h6 class="mb-3"><i class="fas fa-info-circle"></i> Payment Information</h6>
                    <div class="ticket-info">
                        <div class="d-flex justify-content-between align-items-center mb-2">
                            <div>Payment Amount</div>
                            <div class="fw-bold">${paymentResult.currency || 'N/A'}${paymentResult.amount || 'N/A'}</div>
                        </div>
                        <div class="d-flex justify-content-between align-items-center mb-2">
                            <div>Payment Method</div>
                            <div>${getPaymentMethodText(paymentResult.paymentMethod || 'N/A')}</div>
                        </div>
                        <div class="d-flex justify-content-between align-items-center mb-2">
                            <div>Transaction ID</div>
                            <div class="text-muted">${paymentResult.transactionId || 'N/A'}</div>
                        </div>
                        <div class="d-flex justify-content-between align-items-center mb-2">
                            <div>Payment ID</div>
                            <div class="text-muted">${paymentResult.paymentId || 'N/A'}</div>
                        </div>
                        <div class="d-flex justify-content-between align-items-center">
                            <div>Payment Date</div>
                            <div>${paymentResult.paymentDate ? formatDateTime(paymentResult.paymentDate) : 'N/A'}</div>
                        </div>
                    </div>
                </div>
                <div class="col-md-6">
                    <h6 class="mb-3"><i class="fas fa-check-circle"></i> Payment Status</h6>
                    <div class="ticket-info">
                        <div class="d-flex justify-content-between align-items-center mb-2">
                            <div>Status</div>
                            <div class="text-success fw-bold">${paymentResult.status}</div>
                        </div>
                        <div class="d-flex justify-content-between align-items-center mb-2">
                            <div>Message</div>
                            <div class="text-muted">${paymentResult.message || 'N/A'}</div>
                        </div>
                        <div class="d-flex justify-content-between align-items-center mb-2">
                            <div>PNR</div>
                            <div class="text-muted">${bookingResult.confirmationNumber || 'N/A'}</div>
                        </div>
                        <div class="d-flex justify-content-between align-items-center">
                            <div>Flight</div>
                            <div class="text-muted">${bookingResult.flightInfo ? bookingResult.flightInfo.flightNumber : 'N/A'}</div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        console.log('Payment success page rendered successfully');
    } catch (error) {
        console.error('Error rendering payment success:', error);
        alert('Error displaying payment success. Please contact support.');
    }
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

// Format date
function formatDate(dateTimeString) {
    const date = new Date(dateTimeString);
    return date.toLocaleDateString('en-US');
}

// Format date time
function formatDateTime(dateTimeString) {
    const date = new Date(dateTimeString);
    return date.toLocaleString('en-US');
}

// Calculate flight duration (minutes)
function getDurationMinutes(departureTime, arrivalTime) {
    const departure = new Date(departureTime);
    const arrival = new Date(arrivalTime);
    return Math.floor((arrival - departure) / (1000 * 60));
}

// Get payment method text
function getPaymentMethodText(method) {
    const methods = {
        'CREDIT_CARD': 'Credit Card',
        'ALIPAY': 'Alipay',
        'WECHAT': 'WeChat Pay'
    };
    return methods[method] || method;
}

// Download ticket
function downloadTicket() {
    alert('Ticket download feature is under development...');
}