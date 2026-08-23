package app.atherloom.react;

import com.sun.net.httpserver.HttpServer;

import java.net.HttpURLConnection;
import java.net.InetSocketAddress;
import java.util.concurrent.atomic.AtomicInteger;

public final class ProviderEndpointPolicyHarness {
    private ProviderEndpointPolicyHarness() {}

    public static void main(String[] args) throws Exception {
        assertAllowed("https://api.example.com/v1", false);
        for (String endpoint : new String[]{
            "http://localhost:11434/v1",
            "http://127.0.0.1:8876/v1",
            "http://10.0.0.2/v1",
            "http://172.16.0.2/v1",
            "http://172.31.255.254/v1",
            "http://192.168.1.3/v1",
            "http://169.254.1.3/v1",
            "http://100.64.1.3/v1",
            "http://model.local/v1",
            "http://model.home.arpa/v1",
            "http://[::1]:11434/v1",
            "http://[fc00::1]/v1",
            "http://[fe80::1]/v1",
        }) assertAllowed(endpoint, false);

        for (String endpoint : new String[]{
            "http://example.com/v1",
            "http://8.8.8.8/v1",
            "http://172.15.0.1/v1",
            "http://172.32.0.1/v1",
            "http://192.169.1.1/v1",
        }) assertRejected(endpoint, false);
        assertAllowed("http://example.com/v1", true);
        assertRejected("ftp://example.com/model", true);
        assertRejected("https://user:password@example.com/v1", false);

        assertTrue(ProviderEndpointPolicy.sameCredentialScope(
            "openai", "https://API.EXAMPLE.com/v1/", "OPENAI", "https://api.example.com:443/v1"
        ), "equivalent provider scopes must match");
        assertFalse(ProviderEndpointPolicy.sameCredentialScope(
            "openai", "https://api.example.com/v1", "anthropic", "https://api.example.com/v1"
        ), "provider protocol changes must not inherit a key");
        assertFalse(ProviderEndpointPolicy.sameCredentialScope(
            "openai", "https://api.example.com/v1", "openai", "https://other.example.com/v1"
        ), "host changes must not inherit a key");
        assertFalse(ProviderEndpointPolicy.sameCredentialScope(
            "openai", "https://api.example.com/v1", "openai", "https://api.example.com/v2"
        ), "path changes must not inherit a key");

        assertRedirectsAreNotFollowed();
        System.out.println("ProviderEndpointPolicyHarness OK");
    }

    private static void assertAllowed(String endpoint, boolean approved) throws Exception {
        ProviderEndpointPolicy.requireAllowed(endpoint, approved);
    }

    private static void assertRejected(String endpoint, boolean approved) throws Exception {
        try {
            ProviderEndpointPolicy.requireAllowed(endpoint, approved);
            throw new AssertionError("expected rejection: " + endpoint);
        } catch (AssertionError error) {
            throw error;
        } catch (Exception expected) {
            // Expected policy rejection.
        }
    }

    private static void assertRedirectsAreNotFollowed() throws Exception {
        AtomicInteger targetHits = new AtomicInteger();
        HttpServer target = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        target.createContext("/secret", exchange -> {
            targetHits.incrementAndGet();
            exchange.sendResponseHeaders(204, -1);
            exchange.close();
        });
        target.start();

        HttpServer redirector = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        redirector.createContext("/", exchange -> {
            int status = Integer.parseInt(exchange.getRequestURI().getPath().substring(1));
            exchange.getResponseHeaders().add(
                "Location",
                "http://127.0.0.1:" + target.getAddress().getPort() + "/secret"
            );
            exchange.sendResponseHeaders(status, -1);
            exchange.close();
        });
        redirector.start();

        try {
            for (int status : new int[]{301, 302, 303, 307, 308}) {
                HttpURLConnection connection = ProviderEndpointPolicy.openConnection(
                    "http://127.0.0.1:" + redirector.getAddress().getPort() + "/" + status,
                    false
                );
                connection.setRequestProperty("Authorization", "Bearer must-not-leave-first-hop");
                assertFalse(connection.getInstanceFollowRedirects(), "provider redirects must be disabled");
                assertTrue(connection.getResponseCode() == status, "redirect status must reach the caller");
                connection.disconnect();
            }
            assertTrue(targetHits.get() == 0, "redirect target must receive no request or credential");
        } finally {
            redirector.stop(0);
            target.stop(0);
        }
    }

    private static void assertTrue(boolean value, String message) {
        if (!value) throw new AssertionError(message);
    }

    private static void assertFalse(boolean value, String message) {
        assertTrue(!value, message);
    }
}
