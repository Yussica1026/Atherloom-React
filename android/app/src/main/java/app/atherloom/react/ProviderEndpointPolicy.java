package app.atherloom.react;

import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.URL;
import java.util.Locale;

/**
 * Small, native-side guard for credential-bearing Direct Provider requests.
 * Backend URLs are intentionally outside this policy because Atherloom supports
 * user-owned HTTP services on localhost and the LAN.
 */
final class ProviderEndpointPolicy {
    private ProviderEndpointPolicy() {}

    static URL requireAllowed(String rawEndpoint, boolean insecureHttpApproved) throws Exception {
        String candidate = rawEndpoint == null ? "" : rawEndpoint.trim();
        if (candidate.isEmpty()) throw new Exception("请填写模型 Base URL");

        final URL endpoint;
        try {
            endpoint = new URL(candidate);
        } catch (Exception error) {
            throw new Exception("模型 Base URL 不是有效网址", error);
        }

        String protocol = endpoint.getProtocol().toLowerCase(Locale.ROOT);
        if (!"https".equals(protocol) && !"http".equals(protocol)) {
            throw new Exception("模型 Base URL 只支持 http:// 或 https://");
        }
        if (endpoint.getHost() == null || endpoint.getHost().trim().isEmpty()) {
            throw new Exception("模型 Base URL 缺少主机名");
        }
        if (endpoint.getUserInfo() != null && !endpoint.getUserInfo().isEmpty()) {
            throw new Exception("模型 Base URL 不应包含用户名或密码");
        }
        if ("http".equals(protocol)
            && !isLocalOrLanHost(endpoint.getHost())
            && !insecureHttpApproved) {
            throw new Exception("这个 HTTP Direct Provider 可能明文发送 API Key；请改用 HTTPS，或在线路设置中明确确认风险");
        }
        return endpoint;
    }

    static HttpURLConnection openConnection(String rawEndpoint, boolean insecureHttpApproved) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) requireAllowed(rawEndpoint, insecureHttpApproved).openConnection();
        connection.setInstanceFollowRedirects(false);
        return connection;
    }

    static boolean sameCredentialScope(
        String leftProtocol,
        String leftBaseUrl,
        String rightProtocol,
        String rightBaseUrl
    ) {
        if (!normalizedProviderProtocol(leftProtocol).equals(normalizedProviderProtocol(rightProtocol))) return false;
        try {
            return credentialScope(leftBaseUrl).equals(credentialScope(rightBaseUrl));
        } catch (Exception ignored) {
            return false;
        }
    }

    static boolean isLocalOrLanHost(String rawHost) {
        String host = rawHost == null ? "" : rawHost.trim().toLowerCase(Locale.ROOT);
        if (host.startsWith("[") && host.endsWith("]")) host = host.substring(1, host.length() - 1);
        while (host.endsWith(".")) host = host.substring(0, host.length() - 1);
        if (host.isEmpty()) return false;
        if ("localhost".equals(host) || host.endsWith(".localhost")
            || host.endsWith(".local") || host.endsWith(".lan")
            || "home.arpa".equals(host) || host.endsWith(".home.arpa")
            || "host.docker.internal".equals(host) || "gateway.docker.internal".equals(host)) {
            return true;
        }

        int[] ipv4 = parseIpv4(host);
        if (ipv4 != null) {
            return ipv4[0] == 0
                || ipv4[0] == 10
                || ipv4[0] == 127
                || (ipv4[0] == 169 && ipv4[1] == 254)
                || (ipv4[0] == 172 && ipv4[1] >= 16 && ipv4[1] <= 31)
                || (ipv4[0] == 192 && ipv4[1] == 168)
                || (ipv4[0] == 100 && ipv4[1] >= 64 && ipv4[1] <= 127);
        }

        if (host.indexOf(':') >= 0) {
            if (host.startsWith("fc") || host.startsWith("fd")) return true;
            try {
                InetAddress address = InetAddress.getByName(host);
                return address.isAnyLocalAddress()
                    || address.isLoopbackAddress()
                    || address.isLinkLocalAddress()
                    || address.isSiteLocalAddress();
            } catch (Exception ignored) {
                return false;
            }
        }
        return false;
    }

    private static int[] parseIpv4(String host) {
        String[] parts = host.split("\\.", -1);
        if (parts.length != 4) return null;
        int[] values = new int[4];
        for (int index = 0; index < parts.length; index++) {
            String part = parts[index];
            if (part.isEmpty()) return null;
            for (int offset = 0; offset < part.length(); offset++) {
                if (!Character.isDigit(part.charAt(offset))) return null;
            }
            try {
                values[index] = Integer.parseInt(part);
            } catch (NumberFormatException error) {
                return null;
            }
            if (values[index] < 0 || values[index] > 255) return null;
        }
        return values;
    }

    private static String normalizedProviderProtocol(String protocol) {
        return protocol == null ? "" : protocol.trim().toLowerCase(Locale.ROOT);
    }

    private static String credentialScope(String rawBaseUrl) throws Exception {
        URL endpoint = new URL(rawBaseUrl == null ? "" : rawBaseUrl.trim());
        String scheme = endpoint.getProtocol().toLowerCase(Locale.ROOT);
        String host = endpoint.getHost().toLowerCase(Locale.ROOT);
        int port = endpoint.getPort() >= 0 ? endpoint.getPort() : endpoint.getDefaultPort();
        String path = endpoint.getPath() == null ? "" : endpoint.getPath().replaceAll("/+$", "");
        String query = endpoint.getQuery() == null ? "" : "?" + endpoint.getQuery();
        return scheme + "://" + host + ":" + port + path + query;
    }
}
