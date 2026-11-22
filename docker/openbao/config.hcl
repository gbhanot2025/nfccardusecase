# Production OpenBao: file storage on a volume, reachable only on the internal Docker network.
# After the first start it must be initialised and unsealed (docs/runbook.md); after every restart, unsealed again.
storage "file" {
  path = "/openbao/data"
}

listener "tcp" {
  address     = "0.0.0.0:8200"
  # Plain HTTP is acceptable only because the port is never published outside the Docker network.
  tls_disable = true
}

ui            = false
disable_mlock = true
api_addr      = "http://openbao:8200"
