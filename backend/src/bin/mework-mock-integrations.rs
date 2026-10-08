use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener};

use mework_lib::application::{
    dev_overlay::MockIntegrationState, mock_rest::MockIntegrationServer,
};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let port = std::env::var("MEWORK_MOCK_INTEGRATIONS_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(18_372);
    let address = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port);
    let listener = TcpListener::bind(address)?;
    let server = MockIntegrationServer::start_on(MockIntegrationState::new(true), listener).await?;
    println!("Mock integrations ready at http://{}", server.address());
    tokio::signal::ctrl_c().await?;
    drop(server);
    Ok(())
}
