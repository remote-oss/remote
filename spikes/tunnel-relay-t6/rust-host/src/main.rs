//! The T.6 spike's Rust host: `[dev-tunnels]`'s `RelayTunnelHost` (russh with key exchange, host key and cipher all
//! `none`, the path `[cli]` takes) on the spike's relay, forwarding one port to an echo service beside it.

use std::env;
use std::time::Instant;

use tokio::io::copy;
use tokio::net::TcpListener;
use tunnels::connections::RelayTunnelHost;
use tunnels::contracts::{Tunnel, TunnelPort};
use tunnels::management::{
    new_tunnel_management_for_custom_domain, Authorization, TunnelLocator,
    TunnelManagementClient, TunnelRequestOptions,
};

fn required(name: &str) -> String {
    env::var(name).unwrap_or_else(|_| panic!("{} is not set", name))
}

fn say(text: &str) {
    println!("rust-host: {}", text);
}

#[tokio::main]
async fn main() {
    env_logger::init();
    let domain = required("RELAY_DOMAIN");
    let tunnel_id = required("TUNNEL_ID");
    let echo_port: u16 = required("ECHO_PORT").parse().expect("ECHO_PORT is a port");

    let echo = TcpListener::bind(("127.0.0.1", echo_port))
        .await
        .expect("the echo port is free");
    say(&format!("echo service on 127.0.0.1:{}", echo_port));
    tokio::spawn(async move {
        loop {
            if let Ok((socket, _)) = echo.accept().await {
                tokio::spawn(async move {
                    let (mut reader, mut writer) = socket.into_split();
                    let _ = copy(&mut reader, &mut writer).await;
                });
            }
        }
    });

    let mut builder =
        new_tunnel_management_for_custom_domain("tunnel-relay-t6-rust-host", &domain);
    builder.authorization(Authorization::Github("spike-test-token".to_owned()));
    let management: TunnelManagementClient = builder.into();

    let port = TunnelPort {
        port_number: echo_port,
        protocol: Some("auto".to_owned()),
        ..Default::default()
    };
    let tunnel = management
        .create_tunnel(
            Tunnel {
                tunnel_id: Some(tunnel_id),
                ports: vec![port.clone()],
                ..Default::default()
            },
            &TunnelRequestOptions {
                token_scopes: vec!["host".to_owned(), "connect".to_owned()],
                include_ports: true,
                ..Default::default()
            },
        )
        .await
        .expect("the relay creates the tunnel");
    say(&format!(
        "tunnel {} in {}",
        tunnel.tunnel_id.as_deref().unwrap_or("?"),
        tunnel.cluster_id.as_deref().unwrap_or("?")
    ));
    let host_token = tunnel
        .access_tokens
        .as_ref()
        .and_then(|tokens| tokens.get("host"))
        .cloned()
        .expect("the relay issues a host token");
    let locator = TunnelLocator::try_from(&tunnel).expect("the tunnel has an id and a cluster");

    let mut host = RelayTunnelHost::new(locator, management);
    host.add_port(&port).await.expect("the relay accepts the port");
    let started = Instant::now();
    let handle = host
        .connect(&host_token)
        .await
        .expect("the host leg connects");
    say(&format!(
        "host leg connected in {} ms",
        started.elapsed().as_millis()
    ));
    if let Err(error) = handle.await {
        say(&format!("host leg ended: {:?}", error));
    }
}
