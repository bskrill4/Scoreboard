FROM golang:1.23-alpine AS builder
WORKDIR /app

# Copy the module files we just created
COPY go.mod ./

# We'll skip 'go mod download' for now since you only use standard libs.
# As soon as you add a library, you'll uncomment the line below:
# RUN go mod download

COPY . .

# Build the binary named 'scoreboard'
RUN CGO_ENABLED=0 GOOS=linux go build -o scoreboard .

FROM alpine:latest
WORKDIR /root/
# Copy the specific 'scoreboard' binary
COPY --from=builder /app/scoreboard .

EXPOSE 7012

# Run the named binary
CMD ["./scoreboard"]